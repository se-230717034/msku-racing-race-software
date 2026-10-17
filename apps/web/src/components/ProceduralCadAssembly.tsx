import { Edges, Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { ActuationGeometry, Vec3 } from "@msku/contracts";
import { Suspense, useEffect, useMemo } from "react";
import { DoubleSide, Quaternion, Vector3 } from "three";
import { ConvexGeometry } from "three-stdlib";

import { LINKS } from "../domain/geometry";
import type { CadViewMode, VisibilityState, VisualModelSource } from "../store/workspace";
import { GlbCadAssembly } from "./GlbCadAssembly";

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

function RodEndJoint({
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
  const orientation = useMemo(() => {
    const direction = new Vector3(...toward).sub(new Vector3(...position));
    if (direction.lengthSq() <= 1e-12) return new Quaternion();
    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  }, [position, toward]);
  const eyeRadius = 0.0105 * scale;
  const shankLength = 0.026 * scale;
  return (
    <group position={position} quaternion={orientation} name="rod-end-mafsal">
      <mesh castShadow receiveShadow>
        <torusGeometry args={[eyeRadius, eyeRadius * 0.36, 10, 28]} />
        <meshStandardMaterial color="#4d555d" metalness={0.34} roughness={0.58} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[eyeRadius * 0.62, eyeRadius * 0.62, eyeRadius * 1.55, 20]} />
        <meshStandardMaterial color="#252a2f" metalness={0.22} roughness={0.72} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0, eyeRadius * 0.95]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[eyeRadius * 0.84, eyeRadius * 0.84, eyeRadius * 0.28, 6]} />
        <meshStandardMaterial color="#78818a" metalness={0.5} roughness={0.46} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, eyeRadius + shankLength * 0.5, 0]} castShadow>
        <cylinderGeometry args={[eyeRadius * 0.31, eyeRadius * 0.31, shankLength, 12]} />
        <meshStandardMaterial color="#3d444b" metalness={0.38} roughness={0.56} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, eyeRadius + shankLength * 0.14, 0]} castShadow>
        <cylinderGeometry args={[eyeRadius * 0.52, eyeRadius * 0.52, eyeRadius * 0.55, 6]} />
        <meshStandardMaterial color="#69727a" metalness={0.42} roughness={0.5} transparent={opacity < 1} opacity={opacity} />
      </mesh>
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

function CarrierWeb({
  points,
  wheelQuaternion,
  opacity,
}: {
  points: ThreePosition[];
  wheelQuaternion: ThreeQuaternion;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    const wheelAxis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...wheelQuaternion)).normalize();
    const thickness = 0.0055;
    const anchors = points.map((point) => new Vector3(...point));
    const hullPoints = anchors.flatMap((point) => [
      point.clone().addScaledVector(wheelAxis, thickness),
      point.clone().addScaledVector(wheelAxis, -thickness),
    ]);
    return new ConvexGeometry(hullPoints);
  }, [points, wheelQuaternion]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color="#5d646a"
        metalness={0.22}
        roughness={0.68}
        transparent
        opacity={0.92 * opacity}
      />
      <Edges color="#272c30" threshold={18} />
    </mesh>
  );
}

function MountingClevis({
  position,
  wheelQuaternion,
  scale = 1,
  opacity,
}: {
  position: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  scale?: number;
  opacity: number;
}) {
  const plateOffset = 0.0105 * scale;
  return (
    <group position={position} quaternion={wheelQuaternion} scale={scale}>
      {[-plateOffset, plateOffset].map((z) => (
        <mesh key={z} position={[0, 0, z]} castShadow receiveShadow>
          <capsuleGeometry args={[0.0115, 0.023, 8, 18]} />
          <meshStandardMaterial color="#6b737a" metalness={0.26} roughness={0.64} transparent opacity={0.92 * opacity} />
          <Edges color="#30363c" threshold={20} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.0065, 0.0065, plateOffset * 2.65, 18]} />
        <meshStandardMaterial color="#252a2f" metalness={0.5} roughness={0.46} transparent opacity={opacity} />
      </mesh>
      {[-plateOffset * 1.42, plateOffset * 1.42].map((z) => (
        <mesh key={`fastener-${z}`} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.009, 0.009, 0.005, 6]} />
          <meshStandardMaterial color="#889198" metalness={0.48} roughness={0.46} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

function ChassisPickupReference({
  points,
  opacity,
  compact = false,
}: {
  points: ThreePosition[];
  opacity: number;
  compact?: boolean;
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
  const midpoint = (first: ThreePosition, second: ThreePosition): ThreePosition => [
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
    (first[2] + second[2]) / 2,
  ];
  const upperMidpoint = midpoint(points[0], points[1]);
  const lowerMidpoint = midpoint(points[2], points[3]);

  return (
    <group
      name={compact ? "pickup-tasiyici-gorsel-referansi" : "sasi-pickup-referansi"}
      userData={{ visualStatus: compact ? "VISUAL_PICKUP_SUPPORT_NOT_CHASSIS_CAD" : "REFERENCE_CHASSIS_ENVELOPE" }}
    >
      {!compact && <mesh position={bounds.position} castShadow receiveShadow>
        <boxGeometry args={bounds.size} />
        <meshStandardMaterial color="#4f565d" metalness={0.08} roughness={0.78} transparent opacity={0.14 * opacity} depthWrite={false} />
        <Edges color="#727b83" threshold={15} />
      </mesh>}
      {compact && <>
        <TubeBetween start={points[0]} end={points[1]} radius={0.0065} color="#596269" metalness={0.18} roughness={0.72} opacity={0.72 * opacity} />
        <TubeBetween start={points[2]} end={points[3]} radius={0.0075} color="#596269" metalness={0.18} roughness={0.72} opacity={0.72 * opacity} />
        <TubeBetween start={upperMidpoint} end={lowerMidpoint} radius={0.006} color="#596269" metalness={0.18} roughness={0.72} opacity={0.62 * opacity} />
        <Line points={[points[4], lowerMidpoint]} color="#758089" lineWidth={1} dashed dashSize={0.02} gapSize={0.014} transparent opacity={0.58 * opacity} />
      </>}
      {points.map((point, index) => (
        <mesh key={index} position={point} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[compact ? 0.014 : 0.022, compact ? 0.014 : 0.022, compact ? 0.03 : 0.042, 20]} />
          <meshStandardMaterial color="#353b41" metalness={0.22} roughness={0.66} transparent opacity={(compact ? 0.68 : 0.82) * opacity} />
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
  const upperWebInner = addScaledDirection(upper, wheelCentre, 0.026);
  const lowerWebInner = addScaledDirection(lower, wheelCentre, 0.026);
  const tieWebInner = addScaledDirection(tie, wheelCentre, 0.02);
  return (
    <group name="mekanik-upright" userData={{ visualStatus: "PROCEDURAL_NOT_DIMENSIONALLY_VALIDATED" }}>
      <CarrierWeb points={[upperWebInner, wheelCentre, tieWebInner]} wheelQuaternion={wheelQuaternion} opacity={opacity} />
      <CarrierWeb points={[lowerWebInner, wheelCentre, tieWebInner]} wheelQuaternion={wheelQuaternion} opacity={opacity} />
      <TubeBetween start={upperWebInner} end={wheelCentre} radius={0.013} color="#60686f" metalness={0.22} roughness={0.68} opacity={opacity} />
      <TubeBetween start={lowerWebInner} end={wheelCentre} radius={0.015} color="#555d64" metalness={0.22} roughness={0.68} opacity={opacity} />
      <TubeBetween start={tieWebInner} end={wheelCentre} radius={0.010} color="#636b72" metalness={0.2} roughness={0.7} opacity={opacity} />
      <RodEndJoint position={upper} toward={wheelCentre} opacity={opacity} />
      <RodEndJoint position={lower} toward={wheelCentre} opacity={opacity} />
      <RodEndJoint position={tie} toward={wheelCentre} scale={0.82} opacity={opacity} />
      <MountingClevis position={upper} wheelQuaternion={wheelQuaternion} opacity={opacity} />
      <MountingClevis position={lower} wheelQuaternion={wheelQuaternion} opacity={opacity} />
      <MountingClevis position={tie} wheelQuaternion={wheelQuaternion} scale={0.72} opacity={opacity} />
      <group position={wheelCentre} quaternion={wheelQuaternion} name="porya-yatagi">
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.061, 0.057, 0.058, 40]} />
          <meshStandardMaterial color="#596168" metalness={0.26} roughness={0.64} transparent={opacity < 1} opacity={opacity} />
          <Edges color="#20262c" threshold={22} />
        </mesh>
        {[-0.031, 0.031].map((z) => (
          <mesh key={z} position={[0, 0, z]} castShadow>
            <torusGeometry args={[0.052, 0.007, 10, 40]} />
            <meshStandardMaterial color="#7a838a" metalness={0.42} roughness={0.5} transparent={opacity < 1} opacity={opacity} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.034]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.037, 0.037, 0.012, 32]} />
          <meshStandardMaterial color="#262c31" metalness={0.18} roughness={0.76} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      </group>
    </group>
  );
}

function SpringBetween({ start, end }: { start: ThreePosition; end: ThreePosition }) {
  const points = useMemo(() => {
    const from = new Vector3(...start);
    const to = new Vector3(...end);
    const axis = to.clone().sub(from);
    const length = axis.length();
    if (length <= 1e-12) return [from, to];
    const direction = axis.clone().normalize();
    const reference = Math.abs(direction.y) < 0.85 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const firstNormal = new Vector3().crossVectors(direction, reference).normalize();
    const secondNormal = new Vector3().crossVectors(direction, firstNormal).normalize();
    const coilRadius = 0.022;
    const turns = 8;
    return Array.from({ length: 97 }, (_, index) => {
      const t = index / 96;
      const angle = t * turns * Math.PI * 2;
      return from.clone()
        .addScaledVector(axis, t)
        .addScaledVector(firstNormal, Math.cos(angle) * coilRadius)
        .addScaledVector(secondNormal, Math.sin(angle) * coilRadius);
    });
  }, [end, start]);

  return <Line points={points} color="#c89436" lineWidth={2.2} transparent opacity={0.56} />;
}

function RepresentativeActuationLayer({ positionFor }: { positionFor: (id: string) => ThreePosition }) {
  const inboardIds = ["uca_front_inboard", "uca_rear_inboard", "lca_front_inboard", "lca_rear_inboard"];
  const inboards = inboardIds.map(positionFor);
  const chassisCentre: ThreePosition = [
    inboards.reduce((sum, point) => sum + point[0], 0) / inboards.length,
    inboards.reduce((sum, point) => sum + point[1], 0) / inboards.length,
    inboards.reduce((sum, point) => sum + point[2], 0) / inboards.length,
  ];
  const maximumHeight = Math.max(...inboards.map((point) => point[1]));
  const rockerPivot: ThreePosition = [chassisCentre[0], maximumHeight + 0.18, chassisCentre[2]];
  const pushrodRocker: ThreePosition = [rockerPivot[0] + 0.065, rockerPivot[1] - 0.025, rockerPivot[2] - 0.018];
  const damperRocker: ThreePosition = [rockerPivot[0] - 0.055, rockerPivot[1] + 0.018, rockerPivot[2] + 0.008];
  const damperChassis: ThreePosition = [rockerPivot[0] - 0.27, rockerPivot[1] + 0.105, rockerPivot[2] + 0.015];
  const pushrodOutboard = positionFor("lca_outboard");

  return (
    <group name="temsili-calistirma-katmani">
      <TubeBetween start={pushrodOutboard} end={pushrodRocker} radius={0.0065} color="#bd8a2f" metalness={0.16} roughness={0.7} opacity={0.42} />
      <Line points={[pushrodOutboard, pushrodRocker]} color="#f1b94e" lineWidth={1.3} dashed dashSize={0.028} gapSize={0.018} transparent opacity={0.72} />
      <TubeBetween start={rockerPivot} end={pushrodRocker} radius={0.012} color="#b47d2a" metalness={0.18} roughness={0.68} opacity={0.48} />
      <TubeBetween start={rockerPivot} end={damperRocker} radius={0.012} color="#b47d2a" metalness={0.18} roughness={0.68} opacity={0.48} />
      <TubeBetween start={pushrodRocker} end={damperRocker} radius={0.008} color="#96671f" metalness={0.16} roughness={0.72} opacity={0.42} />
      <TubeBetween start={damperRocker} end={damperChassis} radius={0.013} color="#8c672e" metalness={0.18} roughness={0.7} opacity={0.38} />
      <SpringBetween start={damperRocker} end={damperChassis} />
      {[rockerPivot, pushrodRocker, damperRocker, damperChassis].map((position, index) => (
        <mesh key={index} position={position} castShadow>
          <sphereGeometry args={[index === 0 ? 0.018 : 0.013, 16, 12]} />
          <meshStandardMaterial color="#c58c31" metalness={0.18} roughness={0.68} transparent opacity={0.52} />
        </mesh>
      ))}
      <Html position={[rockerPivot[0], rockerPivot[1] + 0.095, rockerPivot[2]]} center>
        <span className="scene-label representative">TEMSİLİ ÇALIŞTIRMA · BAĞLANTI VERİSİ YOK · HAREKETSİZ</span>
      </Html>
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
    <group name="porya-meshi">
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[flangeRadius, flangeRadius * 0.9, width * 0.42, 28]} />
        <meshStandardMaterial color="#5c656e" metalness={0.5} roughness={0.44} />
      </mesh>
      <mesh position={[0, 0, faceZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[flangeRadius * 0.44, flangeRadius * 0.44, width * 0.09, 12]} />
        <meshStandardMaterial color="#343b42" metalness={0.42} roughness={0.54} />
        <Edges color="#15191d" threshold={18} />
      </mesh>
      <mesh position={[0, 0, faceZ + width * 0.075]} castShadow>
        <torusGeometry args={[flangeRadius * 0.42, flangeRadius * 0.085, 10, 32]} />
        <meshStandardMaterial color="#171b1f" metalness={0.12} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0, faceZ + width * 0.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[flangeRadius * 0.2, flangeRadius * 0.2, width * 0.16, 6]} />
        <meshStandardMaterial color="#8a9299" metalness={0.5} roughness={0.46} />
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

function BrakeAssembly({
  rimRadius,
  width,
  showDisc,
  showCaliper,
}: {
  rimRadius: number;
  width: number;
  showDisc: boolean;
  showCaliper: boolean;
}) {
  const discRadius = rimRadius * 0.72;
  const innerRadius = discRadius * 0.34;
  const discZ = -width * 0.16;
  const discThickness = Math.max(width * 0.075, 0.01);
  const faceOffset = discThickness * 0.52;
  return (
    <group name="fren-grubu">
      {showDisc && <group name="fren-diski-meshi">
      <mesh name="fren-diski" position={[0, 0, discZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[discRadius, discRadius, discThickness, 48, 1, true]} />
        <meshStandardMaterial color="#777f87" metalness={0.5} roughness={0.48} side={DoubleSide} />
      </mesh>
      {[-faceOffset, faceOffset].map((offset) => (
        <mesh key={offset} position={[0, 0, discZ + offset]} castShadow>
          <ringGeometry args={[innerRadius, discRadius, 48]} />
          <meshStandardMaterial color="#91989f" metalness={0.46} roughness={0.5} side={DoubleSide} />
        </mesh>
      ))}
      <mesh name="rotor-sapkasi" position={[0, 0, discZ + faceOffset + 0.0008]}>
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
      {Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI * 2 / 8;
        const boltRadius = innerRadius * 1.28;
        return (
          <mesh key={`rotor-bolt-${index}`} position={[Math.cos(angle) * boltRadius, Math.sin(angle) * boltRadius, discZ + faceOffset + 0.0025]}>
            <circleGeometry args={[discRadius * 0.022, 8]} />
            <meshStandardMaterial color="#30363b" metalness={0.42} roughness={0.52} />
          </mesh>
        );
      })}
      </group>}
      {showCaliper && <group position={[discRadius * 0.83, discRadius * 0.04, discZ]} rotation={[0, 0, -0.12]} name="fren-kaliperi-meshi">
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
        {[-discRadius * 0.09, discRadius * 0.09].map((y) => (
          <group key={`piston-${y}`} position={[discRadius * 0.1, y, discThickness * 0.9]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[discRadius * 0.055, discRadius * 0.055, discThickness * 0.18, 20]} />
              <meshStandardMaterial color="#4a171f" metalness={0.16} roughness={0.72} />
            </mesh>
          </group>
        ))}
        {[-discRadius * 0.115, discRadius * 0.115].map((y) => (
          <mesh key={`caliper-bolt-${y}`} position={[discRadius * 0.12, y, discThickness * 1.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[discRadius * 0.026, discRadius * 0.026, discThickness * 0.16, 6]} />
            <meshStandardMaterial color="#a1a7ac" metalness={0.48} roughness={0.46} />
          </mesh>
        ))}
      </group>}
    </group>
  );
}

export function ProceduralWheel({
  position,
  quaternion,
  radius,
  width,
  mode,
  showTire = true,
  showRim = true,
  showBrakeDisc = true,
  showCaliper = true,
  showHub = true,
  opacity = 1,
  name,
}: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  width: number;
  mode: CadViewMode;
  showTire?: boolean;
  showRim?: boolean;
  showBrakeDisc?: boolean;
  showCaliper?: boolean;
  showHub?: boolean;
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
      {showTire && <group name="lastik-katmani">
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
      </group>}
      {showRim && <group name="jant-katmani">
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!technical} receiveShadow>
          <cylinderGeometry args={[rimRadius, rimRadius, rimWidth, 40, 1, true]} />
          <meshStandardMaterial
            color="#555e67"
            metalness={0.34}
            roughness={0.58}
            wireframe={technical}
            transparent={technical || opacity < 1}
            opacity={technical ? 0.45 * opacity : opacity}
            side={DoubleSide}
          />
        </mesh>
        {[-rimWidth / 2, rimWidth / 2].map((z) => (
          <mesh key={z} position={[0, 0, z]}>
            <torusGeometry args={[rimRadius * 0.97, rimRadius * 0.036, 10, 48]} />
            <meshStandardMaterial color="#777f87" metalness={0.38} roughness={0.52} wireframe={technical} transparent={opacity < 1} opacity={opacity} />
          </mesh>
        ))}
        {!technical && opacity >= 0.5 && <RimStructure rimRadius={rimRadius} width={rimWidth} />}
      </group>}
      {!technical && opacity >= 0.5 && <>
        {(showBrakeDisc || showCaliper) && (
          <BrakeAssembly
            rimRadius={rimRadius}
            width={rimWidth}
            showDisc={showBrakeDisc}
            showCaliper={showCaliper}
          />
        )}
        {showHub && <HubAssembly rimRadius={rimRadius} width={rimWidth} />}
      </>}
      {technical && showHub && <mesh rotation={[Math.PI / 2, 0, 0]}>
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
  staticPositionFor,
  wheelPosition,
  wheelQuaternion,
  wheelRadius,
  wheelWidth,
  visibility,
  mode,
  showMechanism = true,
  showRepresentativeActuation = false,
  visualModelSource = "procedural",
  importedAssetMirrored = false,
  actuation,
  actuationPointFor,
  selectedHardpointId,
  onSelectHardpoint,
  opacity = 1,
}: {
  assemblyId: string;
  hardpointIds: string[];
  positionFor: (id: string) => ThreePosition;
  staticPositionFor?: (id: string) => ThreePosition;
  wheelPosition: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  wheelRadius: number;
  wheelWidth: number;
  visibility: VisibilityState;
  mode: CadViewMode;
  showMechanism?: boolean;
  showRepresentativeActuation?: boolean;
  visualModelSource?: VisualModelSource;
  importedAssetMirrored?: boolean;
  actuation?: ActuationGeometry;
  actuationPointFor?: (point: Vec3) => ThreePosition;
  selectedHardpointId?: string;
  onSelectHardpoint?: (id: string) => void;
  opacity?: number;
}) {
  const showTechnical = mode !== "detailed";
  const showDetailed = mode !== "technical";
  const useImportedParts = visualModelSource === "glb";
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
  const importedFallback = <>
    {showMechanism && visibility.upright && (
      <MechanicalUpright
        upper={upperOutboard}
        lower={lowerOutboard}
        tie={tieOutboard}
        wheelCentre={wheelPosition}
        wheelQuaternion={wheelQuaternion}
        opacity={opacity}
      />
    )}
    {(visibility.upright || (visibility.wheel && (
      visibility.tire
      || visibility.rim
      || visibility.hub
      || (visibility.brake && (visibility.brakeDisc || visibility.caliper))
    ))) && (
      <ProceduralWheel
        name={`loading-wheel-${assemblyId}`}
        position={wheelPosition}
        quaternion={wheelQuaternion}
        radius={wheelRadius}
        width={wheelWidth}
        mode={mode}
        showTire={visibility.wheel && visibility.tire}
        showRim={visibility.wheel && visibility.rim}
        showBrakeDisc={visibility.wheel && visibility.brake && visibility.brakeDisc}
        showCaliper={visibility.wheel && visibility.brake && visibility.caliper}
        showHub={visibility.wheel && visibility.hub}
        opacity={opacity}
      />
    )}
  </>;

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
        {(visibility.chassis || useImportedParts) && (
          <ChassisPickupReference
            points={chassisPickupPoints}
            opacity={opacity}
            compact={!visibility.chassis}
          />
        )}
        {visibility.upright && !useImportedParts && (
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
        {visibility.steering && <RodEndJoint position={positionFor("tie_rod_inboard")} toward={tieOutboard} scale={0.75} opacity={opacity} />}
        {useImportedParts && visibility.upright && <>
          <RodEndJoint position={upperOutboard} toward={wheelPosition} opacity={opacity} />
          <RodEndJoint position={lowerOutboard} toward={wheelPosition} opacity={opacity} />
          <RodEndJoint position={tieOutboard} toward={wheelPosition} scale={0.82} opacity={opacity} />
        </>}
      </>}
      {showMechanism && showRepresentativeActuation && !useImportedParts && (
        <RepresentativeActuationLayer positionFor={staticPositionFor ?? positionFor} />
      )}
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
      {!useImportedParts && (visibility.upright || (visibility.wheel && (
        visibility.tire
        || visibility.rim
        || visibility.hub
        || (visibility.brake && (visibility.brakeDisc || visibility.caliper))
      ))) && (
        <ProceduralWheel
          name={`wheel-${assemblyId}`}
          position={wheelPosition}
          quaternion={wheelQuaternion}
          radius={wheelRadius}
          width={wheelWidth}
          mode={mode}
          showTire={visibility.wheel && visibility.tire}
          showRim={visibility.wheel && visibility.rim}
          showBrakeDisc={visibility.wheel && visibility.brake && visibility.brakeDisc}
          showCaliper={visibility.wheel && visibility.brake && visibility.caliper}
          showHub={visibility.wheel && visibility.hub}
          opacity={opacity}
        />
      )}
      {useImportedParts && (
        <Suspense fallback={importedFallback}>
          <GlbCadAssembly
            positionFor={positionFor}
            referencePositionFor={staticPositionFor ?? positionFor}
            wheelPosition={wheelPosition}
            wheelQuaternion={wheelQuaternion}
            wheelRadius={wheelRadius}
            wheelWidth={wheelWidth}
            visibility={visibility}
            mirrored={importedAssetMirrored}
            showRepresentativeSuspension={showMechanism && showRepresentativeActuation}
            actuation={actuation}
            actuationPointFor={actuationPointFor}
            opacity={opacity}
          />
        </Suspense>
      )}
    </group>
  );
}

export function CadTube(props: Parameters<typeof TubeBetween>[0]) {
  return <TubeBetween {...props} />;
}
