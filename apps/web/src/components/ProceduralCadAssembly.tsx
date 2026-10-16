import { Edges, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { DoubleSide, Quaternion, Vector3 } from "three";
import { ConvexGeometry } from "three-stdlib";

import { LINKS } from "../domain/geometry";
import type { CadViewMode, VisibilityState } from "../store/workspace";

export type ThreePosition = [number, number, number];
export type ThreeQuaternion = [number, number, number, number];

const LINK_COLORS = {
  upper: "#765273",
  lower: "#3f5d86",
  steering: "#737980",
  upright: "#7d3e49",
  wheel: "#69737d",
} as const;

const LINK_RADII = {
  upper: 0.009,
  lower: 0.01,
  steering: 0.006,
  upright: 0.014,
  wheel: 0.01,
} as const;

const addScaledDirection = (
  origin: ThreePosition,
  target: ThreePosition,
  scale: number,
): ThreePosition => {
  const direction = new Vector3(...target).sub(new Vector3(...origin)).normalize().multiplyScalar(scale);
  return [origin[0] + direction.x, origin[1] + direction.y, origin[2] + direction.z];
};

function TubeBetween({
  start,
  end,
  radius,
  color,
  opacity = 1,
  metalness = 0.42,
  roughness = 0.5,
}: {
  start: ThreePosition;
  end: ThreePosition;
  radius: number;
  color: string;
  opacity?: number;
  metalness?: number;
  roughness?: number;
}) {
  const transform = useMemo(() => {
    const from = new Vector3(...start);
    const to = new Vector3(...end);
    const direction = to.clone().sub(from);
    const length = direction.length();
    const quaternion = new Quaternion();
    if (length > 1e-12) {
      quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    }
    return {
      length,
      midpoint: from.add(to).multiplyScalar(0.5),
      quaternion,
    };
  }, [end, start]);

  if (transform.length <= 1e-12) return null;
  return (
    <mesh position={transform.midpoint} quaternion={transform.quaternion} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, transform.length, 16, 1]} />
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function HardpointMarker({
  position,
  selected = false,
  opacity = 1,
  onClick,
}: {
  position: ThreePosition;
  selected?: boolean;
  opacity?: number;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <mesh position={position} scale={selected ? 1.4 : 1} castShadow onClick={onClick}>
      <sphereGeometry args={[0.0075, 14, 10]} />
      <meshStandardMaterial
        color={selected ? "#ff304f" : "#d7dde3"}
        metalness={0.25}
        roughness={0.55}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function BallJoint({
  position,
  toward,
  scale = 1,
  opacity = 1,
}: {
  position: ThreePosition;
  toward: ThreePosition;
  scale?: number;
  opacity?: number;
}) {
  const collarEnd = addScaledDirection(position, toward, 0.024 * scale);
  return (
    <group>
      <mesh position={position} castShadow receiveShadow>
        <sphereGeometry args={[0.015 * scale, 18, 12]} />
        <meshStandardMaterial color="#626b74" metalness={0.48} roughness={0.46} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <TubeBetween start={position} end={collarEnd} radius={0.0105 * scale} color="#414951" metalness={0.38} roughness={0.58} opacity={opacity} />
    </group>
  );
}

function PivotBushing({
  position,
  axisTarget,
  opacity = 1,
}: {
  position: ThreePosition;
  axisTarget: ThreePosition;
  opacity?: number;
}) {
  const start = addScaledDirection(position, axisTarget, -0.014);
  const end = addScaledDirection(position, axisTarget, 0.014);
  const pinStart = addScaledDirection(position, axisTarget, -0.018);
  const pinEnd = addScaledDirection(position, axisTarget, 0.018);
  return (
    <group>
      <TubeBetween start={start} end={end} radius={0.015} color="#343b43" metalness={0.24} roughness={0.68} opacity={opacity} />
      <TubeBetween start={pinStart} end={pinEnd} radius={0.006} color="#87919b" metalness={0.55} roughness={0.4} opacity={opacity} />
    </group>
  );
}

function UprightCasting({
  upper,
  lower,
  tie,
  wheelCentre,
  wheelQuaternion,
  opacity,
}: {
  upper: ThreePosition;
  lower: ThreePosition;
  tie: ThreePosition;
  wheelCentre: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    const wheelAxis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...wheelQuaternion)).normalize();
    const thickness = 0.012;
    const anchors = [upper, lower, tie, wheelCentre].map((point) => new Vector3(...point));
    const hullPoints = anchors.flatMap((point) => [
      point.clone().addScaledVector(wheelAxis, thickness),
      point.clone().addScaledVector(wheelAxis, -thickness),
    ]);
    return new ConvexGeometry(hullPoints);
  }, [lower, tie, upper, wheelCentre, wheelQuaternion]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color="#71343e"
        metalness={0.26}
        roughness={0.62}
        transparent
        opacity={0.78 * opacity}
      />
      <Edges color="#351b20" threshold={18} />
    </mesh>
  );
}

function ChassisPickupReference({
  points,
  opacity,
}: {
  points: ThreePosition[];
  opacity: number;
}) {
  const bounds = useMemo(() => {
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const zs = points.map((point) => point[2]);
    const minimumX = Math.min(...xs);
    const maximumX = Math.max(...xs);
    const minimumY = Math.min(...ys);
    const maximumY = Math.max(...ys);
    return {
      position: [
        (minimumX + maximumX) / 2,
        (minimumY + maximumY) / 2,
        zs.reduce((sum, value) => sum + value, 0) / zs.length,
      ] as ThreePosition,
      size: [Math.max(maximumX - minimumX + 0.13, 0.2), Math.max(maximumY - minimumY + 0.14, 0.28), 0.028] as ThreePosition,
    };
  }, [points]);

  return (
    <group name="sasi-pickup-referansi">
      <mesh position={bounds.position} castShadow receiveShadow>
        <boxGeometry args={bounds.size} />
        <meshStandardMaterial color="#4f565d" metalness={0.08} roughness={0.78} transparent opacity={0.34 * opacity} />
        <Edges color="#727b83" threshold={15} />
      </mesh>
      {points.map((point, index) => (
        <mesh key={index} position={point} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.042, 20]} />
          <meshStandardMaterial color="#353b41" metalness={0.22} roughness={0.66} transparent opacity={0.82 * opacity} />
        </mesh>
      ))}
    </group>
  );
}

function MechanicalUpright({
  upper,
  lower,
  tie,
  wheelCentre,
  wheelQuaternion,
  opacity,
}: {
  upper: ThreePosition;
  lower: ThreePosition;
  tie: ThreePosition;
  wheelCentre: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  opacity: number;
}) {
  return (
    <group name="mekanik-upright">
      <UprightCasting upper={upper} lower={lower} tie={tie} wheelCentre={wheelCentre} wheelQuaternion={wheelQuaternion} opacity={opacity} />
      <TubeBetween start={lower} end={upper} radius={0.018} color="#743640" metalness={0.24} roughness={0.62} opacity={opacity} />
      <TubeBetween start={upper} end={wheelCentre} radius={0.011} color="#81404b" metalness={0.24} roughness={0.62} opacity={opacity} />
      <TubeBetween start={lower} end={wheelCentre} radius={0.013} color="#67313a" metalness={0.24} roughness={0.62} opacity={opacity} />
      <TubeBetween start={tie} end={wheelCentre} radius={0.009} color="#81404b" metalness={0.24} roughness={0.62} opacity={opacity} />
      <BallJoint position={upper} toward={lower} opacity={opacity} />
      <BallJoint position={lower} toward={upper} opacity={opacity} />
      <BallJoint position={tie} toward={wheelCentre} scale={0.82} opacity={opacity} />
      <group position={wheelCentre} quaternion={wheelQuaternion}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.052, 0.052, 0.054, 28]} />
          <meshStandardMaterial color="#4b545d" metalness={0.42} roughness={0.5} transparent={opacity < 1} opacity={opacity} />
          <Edges color="#20262c" threshold={22} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.054, 0.006, 10, 32]} />
          <meshStandardMaterial color="#737d86" metalness={0.5} roughness={0.42} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      </group>
    </group>
  );
}

function SlickTireDetails({ radius, width, sidewall }: { radius: number; width: number; sidewall: number }) {
  const shoulderRadius = radius - sidewall * 0.36;
  return (
    <group>
      {[-width * 0.43, width * 0.43].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[shoulderRadius, sidewall * 0.055, 8, 64]} />
          <meshStandardMaterial color="#292d31" metalness={0.01} roughness={0.96} />
        </mesh>
      ))}
      <mesh position={[0, 0, width * 0.49]}>
        <torusGeometry args={[radius - sidewall * 0.96, sidewall * 0.025, 6, 64]} />
        <meshStandardMaterial color="#44494d" metalness={0.02} roughness={0.92} />
      </mesh>
    </group>
  );
}

function SpokeBeam({ start, end, width, depth }: {
  start: [number, number];
  end: [number, number];
  width: number;
  depth: number;
}) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  return (
    <mesh
      position={[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, 0]}
      rotation={[0, 0, Math.atan2(dy, dx)]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length, width, depth]} />
      <meshStandardMaterial color="#858e97" metalness={0.48} roughness={0.42} />
      <Edges color="#343b42" threshold={28} />
    </mesh>
  );
}

function RimStructure({ rimRadius, width }: { rimRadius: number; width: number }) {
  const hubRadius = rimRadius * 0.2;
  const branchRadius = rimRadius * 0.52;
  const outerRadius = rimRadius * 0.89;
  return (
    <group position={[0, 0, width * 0.24]}>
      {Array.from({ length: 5 }, (_, index) => {
        const baseAngle = index * Math.PI * 2 / 5;
        const branch: [number, number] = [Math.cos(baseAngle) * branchRadius, Math.sin(baseAngle) * branchRadius];
        const inner: [number, number] = [Math.cos(baseAngle) * hubRadius, Math.sin(baseAngle) * hubRadius];
        const spread = Math.PI / 15;
        const firstOuter: [number, number] = [Math.cos(baseAngle - spread) * outerRadius, Math.sin(baseAngle - spread) * outerRadius];
        const secondOuter: [number, number] = [Math.cos(baseAngle + spread) * outerRadius, Math.sin(baseAngle + spread) * outerRadius];
        return (
          <group key={index}>
            <SpokeBeam start={inner} end={branch} width={rimRadius * 0.085} depth={width * 0.105} />
            <SpokeBeam start={branch} end={firstOuter} width={rimRadius * 0.055} depth={width * 0.09} />
            <SpokeBeam start={branch} end={secondOuter} width={rimRadius * 0.055} depth={width * 0.09} />
          </group>
        );
      })}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[hubRadius * 1.18, hubRadius * 1.18, width * 0.13, 28]} />
        <meshStandardMaterial color="#747e87" metalness={0.48} roughness={0.43} />
      </mesh>
    </group>
  );
}

function HubAssembly({ rimRadius, width }: { rimRadius: number; width: number }) {
  const flangeRadius = rimRadius * 0.23;
  const faceZ = width * 0.32;
  return (
    <group name="porya">
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[flangeRadius, flangeRadius * 0.9, width * 0.42, 28]} />
        <meshStandardMaterial color="#5c656e" metalness={0.5} roughness={0.44} />
      </mesh>
      <mesh position={[0, 0, faceZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[flangeRadius * 0.44, flangeRadius * 0.44, width * 0.09, 12]} />
        <meshStandardMaterial color="#343b42" metalness={0.42} roughness={0.54} />
        <Edges color="#15191d" threshold={18} />
      </mesh>
      {Array.from({ length: 5 }, (_, index) => {
        const angle = index * Math.PI * 2 / 5;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * flangeRadius * 0.68, Math.sin(angle) * flangeRadius * 0.68, faceZ + width * 0.025]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[flangeRadius * 0.09, flangeRadius * 0.09, width * 0.06, 10]} />
            <meshStandardMaterial color="#242a30" metalness={0.5} roughness={0.48} />
          </mesh>
        );
      })}
    </group>
  );
}

function BrakeAssembly({ rimRadius, width }: { rimRadius: number; width: number }) {
  const discRadius = rimRadius * 0.72;
  const innerRadius = discRadius * 0.34;
  const discZ = -width * 0.16;
  const discThickness = Math.max(width * 0.075, 0.01);
  const faceOffset = discThickness * 0.52;
  return (
    <group name="fren-grubu">
      <mesh position={[0, 0, discZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[discRadius, discRadius, discThickness, 48, 1, true]} />
        <meshStandardMaterial color="#777f87" metalness={0.5} roughness={0.48} side={DoubleSide} />
      </mesh>
      {[-faceOffset, faceOffset].map((offset) => (
        <mesh key={offset} position={[0, 0, discZ + offset]} castShadow>
          <ringGeometry args={[innerRadius, discRadius, 48]} />
          <meshStandardMaterial color="#91989f" metalness={0.46} roughness={0.5} side={DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, 0, discZ + faceOffset + 0.0008]}>
        <ringGeometry args={[innerRadius, innerRadius * 1.55, 36]} />
        <meshStandardMaterial color="#4e5861" metalness={0.42} roughness={0.54} side={DoubleSide} />
      </mesh>
      {Array.from({ length: 14 }, (_, index) => {
        const angle = index * Math.PI * 2 / 14;
        const vaneRadius = (innerRadius + discRadius) * 0.52;
        return (
          <mesh key={`vane-${index}`} position={[Math.cos(angle) * vaneRadius, Math.sin(angle) * vaneRadius, discZ]} rotation={[0, 0, angle + 0.22]}>
            <boxGeometry args={[discRadius * 0.25, discRadius * 0.026, discThickness * 0.88]} />
            <meshStandardMaterial color="#545c63" metalness={0.35} roughness={0.58} />
          </mesh>
        );
      })}
      {Array.from({ length: 20 }, (_, index) => {
        const angle = index * Math.PI * 2 / 20;
        const holeRadius = discRadius * (index % 2 === 0 ? 0.67 : 0.82);
        return (
          <mesh key={`hole-${index}`} position={[Math.cos(angle) * holeRadius, Math.sin(angle) * holeRadius, discZ + faceOffset + 0.0015]}>
            <circleGeometry args={[discRadius * 0.028, 10]} />
            <meshStandardMaterial color="#252a2f" metalness={0.08} roughness={0.74} />
          </mesh>
        );
      })}
      <group position={[discRadius * 0.83, discRadius * 0.04, discZ]} rotation={[0, 0, -0.12]} name="fren-kaliperi">
        {[-discThickness * 0.82, discThickness * 0.82].map((z) => (
          <mesh key={z} position={[0, 0, z]} castShadow receiveShadow>
            <capsuleGeometry args={[discRadius * 0.105, discRadius * 0.22, 8, 16]} />
            <meshStandardMaterial color="#7d2532" metalness={0.22} roughness={0.58} />
            <Edges color="#401018" threshold={24} />
          </mesh>
        ))}
        <mesh position={[discRadius * 0.07, 0, 0]} castShadow>
          <boxGeometry args={[discRadius * 0.17, discRadius * 0.28, discThickness * 1.72]} />
          <meshStandardMaterial color="#74202d" metalness={0.2} roughness={0.62} />
          <Edges color="#3c1118" threshold={25} />
        </mesh>
        {[-discThickness * 0.56, discThickness * 0.56].map((z) => (
          <mesh key={`pad-${z}`} position={[-discRadius * 0.065, 0, z]}>
            <boxGeometry args={[discRadius * 0.06, discRadius * 0.24, discThickness * 0.16]} />
            <meshStandardMaterial color="#202327" metalness={0.04} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function ProceduralWheel({ position, quaternion, radius, width, mode, opacity = 1, name }: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  width: number;
  mode: CadViewMode;
  opacity?: number;
  name: string;
}) {
  const technical = mode === "technical";
  const sidewall = Math.min(radius * 0.2, Math.max(radius * 0.135, width * 0.27));
  const rimRadius = Math.max(radius - 2.08 * sidewall, radius * 0.49);
  const rimWidth = width * 0.8;
  const tireMajorRadius = Math.max(radius - sidewall, 0.01);
  const tireDepthScale = width / Math.max(sidewall * 2, 0.001);

  return (
    <group name={name} position={position} quaternion={quaternion}>
      <mesh scale={[1, 1, tireDepthScale]} castShadow={!technical} receiveShadow>
        <torusGeometry args={[tireMajorRadius, sidewall, 18, 64]} />
        <meshStandardMaterial
          color={technical ? "#5d6975" : "#202327"}
          roughness={technical ? 0.62 : 0.96}
          metalness={technical ? 0.08 : 0.01}
          wireframe={technical}
          transparent={technical || opacity < 1}
          opacity={technical ? 0.5 * opacity : opacity}
        />
      </mesh>
      {!technical && opacity >= 0.5 && <SlickTireDetails radius={radius} width={width} sidewall={sidewall} />}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!technical} receiveShadow>
        <cylinderGeometry args={[rimRadius, rimRadius, rimWidth, 40, 1, true]} />
        <meshStandardMaterial
          color="#555e67"
          metalness={0.42}
          roughness={0.5}
          wireframe={technical}
          transparent={technical || opacity < 1}
          opacity={technical ? 0.45 * opacity : opacity}
          side={DoubleSide}
        />
      </mesh>
      {[-rimWidth / 2, rimWidth / 2].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[rimRadius * 0.97, rimRadius * 0.036, 10, 48]} />
          <meshStandardMaterial color="#777f87" metalness={0.46} roughness={0.44} wireframe={technical} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ))}
      {!technical && opacity >= 0.5 && <>
        <BrakeAssembly rimRadius={rimRadius} width={rimWidth} />
        <RimStructure rimRadius={rimRadius} width={rimWidth} />
        <HubAssembly rimRadius={rimRadius} width={rimWidth} />
      </>}
      {technical && <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[rimRadius * 0.22, rimRadius * 0.22, rimWidth * 0.58, 24]} />
        <meshStandardMaterial color="#68727e" metalness={0.22} roughness={0.62} wireframe transparent opacity={0.55 * opacity} />
      </mesh>}
    </group>
  );
}

export function ProceduralCadAssembly({
  assemblyId,
  hardpointIds,
  positionFor,
  wheelPosition,
  wheelQuaternion,
  wheelRadius,
  wheelWidth,
  visibility,
  mode,
  showMechanism = true,
  selectedHardpointId,
  onSelectHardpoint,
  opacity = 1,
}: {
  assemblyId: string;
  hardpointIds: string[];
  positionFor: (id: string) => ThreePosition;
  wheelPosition: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  wheelRadius: number;
  wheelWidth: number;
  visibility: VisibilityState;
  mode: CadViewMode;
  showMechanism?: boolean;
  selectedHardpointId?: string;
  onSelectHardpoint?: (id: string) => void;
  opacity?: number;
}) {
  const showTechnical = mode !== "detailed";
  const showDetailed = mode !== "technical";
  const upperOutboard = positionFor("uca_outboard");
  const lowerOutboard = positionFor("lca_outboard");
  const tieOutboard = positionFor("tie_rod_outboard");
  const chassisPickupPoints = [
    positionFor("uca_front_inboard"),
    positionFor("uca_rear_inboard"),
    positionFor("lca_front_inboard"),
    positionFor("lca_rear_inboard"),
    positionFor("tie_rod_inboard"),
  ];

  return (
    <group name={`cad-assembly-${assemblyId}`}>
      {showMechanism && LINKS.map((link) => {
        if (!visibility[link.group]) return null;
        const start = positionFor(link.start);
        const end = positionFor(link.end);
        const detailedLinkIsHandledByUpright = link.group === "upright" || link.group === "wheel";
        return (
          <group key={`${assemblyId}-${link.id}`}>
            {showDetailed && !detailedLinkIsHandledByUpright && (
              <TubeBetween start={start} end={end} radius={LINK_RADII[link.group]} color={LINK_COLORS[link.group]} opacity={opacity} />
            )}
            {showTechnical && (
              <Line
                points={[start, end]}
                color={LINK_COLORS[link.group]}
                lineWidth={mode === "technical" ? 2.2 : 1}
                transparent={opacity < 1 || mode === "hybrid"}
                opacity={mode === "hybrid" ? 0.6 * opacity : opacity}
              />
            )}
          </group>
        );
      })}
      {showMechanism && showDetailed && <>
        {visibility.chassis && <ChassisPickupReference points={chassisPickupPoints} opacity={opacity} />}
        {(visibility.upright || visibility.wheel) && (
          <MechanicalUpright
            upper={upperOutboard}
            lower={lowerOutboard}
            tie={tieOutboard}
            wheelCentre={wheelPosition}
            wheelQuaternion={wheelQuaternion}
            opacity={opacity}
          />
        )}
        {visibility.upper && <>
          <PivotBushing position={positionFor("uca_front_inboard")} axisTarget={positionFor("uca_rear_inboard")} opacity={opacity} />
          <PivotBushing position={positionFor("uca_rear_inboard")} axisTarget={positionFor("uca_front_inboard")} opacity={opacity} />
        </>}
        {visibility.lower && <>
          <PivotBushing position={positionFor("lca_front_inboard")} axisTarget={positionFor("lca_rear_inboard")} opacity={opacity} />
          <PivotBushing position={positionFor("lca_rear_inboard")} axisTarget={positionFor("lca_front_inboard")} opacity={opacity} />
        </>}
        {visibility.steering && <BallJoint position={positionFor("tie_rod_inboard")} toward={tieOutboard} scale={0.75} opacity={opacity} />}
      </>}
      {showMechanism && visibility.hardpoints && hardpointIds.map((id) => (
        <HardpointMarker
          key={`${assemblyId}-${id}`}
          position={positionFor(id)}
          selected={id === selectedHardpointId}
          opacity={opacity}
          onClick={onSelectHardpoint ? (event) => {
            event.stopPropagation();
            onSelectHardpoint(id);
          } : undefined}
        />
      ))}
      {visibility.wheel && (
        <ProceduralWheel
          name={`wheel-${assemblyId}`}
          position={wheelPosition}
          quaternion={wheelQuaternion}
          radius={wheelRadius}
          width={wheelWidth}
          mode={mode}
          opacity={opacity}
        />
      )}
    </group>
  );
}

export function CadTube(props: Parameters<typeof TubeBetween>[0]) {
  return <TubeBetween {...props} />;
}
