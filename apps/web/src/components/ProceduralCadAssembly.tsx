import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { DoubleSide, Quaternion, Vector3 } from "three";

import { LINKS } from "../domain/geometry";
import type { CadViewMode, VisibilityState } from "../store/workspace";

export type ThreePosition = [number, number, number];
export type ThreeQuaternion = [number, number, number, number];

const LINK_COLORS = {
  upper: "#dce3ed",
  lower: "#9da9b8",
  steering: "#ef233c",
  upright: "#eef2f7",
  wheel: "#aeb9c8",
} as const;

const LINK_RADII = {
  upper: 0.009,
  lower: 0.01,
  steering: 0.006,
  upright: 0.015,
  wheel: 0.012,
} as const;

function TubeBetween({
  start,
  end,
  radius,
  color,
  opacity = 1,
  metalness = 0.72,
  roughness = 0.28,
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
    <mesh
      position={transform.midpoint}
      quaternion={transform.quaternion}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[radius, radius, transform.length, 12, 1]} />
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

function Joint({
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
    <group position={position} scale={selected ? 1.35 : 1}>
      <mesh castShadow receiveShadow onClick={onClick}>
        <sphereGeometry args={[0.0135, 16, 12]} />
        <meshStandardMaterial
          color={selected ? "#ff304f" : "#d9e0e9"}
          metalness={0.82}
          roughness={0.2}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.0145, 0.0022, 8, 20]} />
        <meshStandardMaterial color="#424b58" metalness={0.9} roughness={0.18} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}

function WheelTread({ radius, width }: { radius: number; width: number }) {
  const count = 20;
  const sidewall = Math.min(radius * 0.22, Math.max(radius * 0.14, width * 0.3));
  const treadRadius = radius - sidewall * 0.12;
  return (
    <group>
      {Array.from({ length: count }, (_, index) => {
        const angle = index * Math.PI * 2 / count;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * treadRadius, Math.sin(angle) * treadRadius, 0]}
            rotation={[0, 0, angle]}
            castShadow
          >
            <boxGeometry args={[sidewall * 0.35, sidewall * 0.95, width * 1.015]} />
            <meshStandardMaterial color="#101318" roughness={0.9} metalness={0.02} />
          </mesh>
        );
      })}
    </group>
  );
}

function RimSpokes({ rimRadius, width }: { rimRadius: number; width: number }) {
  const count = 10;
  const hubRadius = rimRadius * 0.2;
  const spokeLength = rimRadius * 0.64;
  const centre = hubRadius + spokeLength * 0.48;
  return (
    <group>
      {Array.from({ length: count }, (_, index) => {
        const angle = index * Math.PI * 2 / count;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * centre, Math.sin(angle) * centre, width * 0.22]}
            rotation={[0, 0, angle]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[spokeLength, rimRadius * 0.07, width * 0.11]} />
            <meshStandardMaterial color="#b9c2cd" metalness={0.92} roughness={0.16} />
          </mesh>
        );
      })}
    </group>
  );
}

function BrakeAssembly({ rimRadius, width }: { rimRadius: number; width: number }) {
  const discRadius = rimRadius * 0.72;
  const discZ = -width * 0.18;
  return (
    <group>
      <mesh position={[0, 0, discZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[discRadius, discRadius, 0.012, 40]} />
        <meshStandardMaterial color="#87919d" metalness={0.96} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0, discZ - 0.0065]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[discRadius * 0.28, discRadius * 0.88, 40]} />
        <meshStandardMaterial color="#c6ced7" metalness={0.92} roughness={0.22} side={DoubleSide} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = index * Math.PI * 2 / 12;
        const holeRadius = discRadius * 0.69;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * holeRadius, Math.sin(angle) * holeRadius, discZ - 0.013]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[discRadius * 0.035, discRadius * 0.035, 0.002, 10]} />
            <meshStandardMaterial color="#242a31" roughness={0.5} />
          </mesh>
        );
      })}
      <mesh position={[discRadius * 0.82, discRadius * 0.08, discZ]} rotation={[0, 0, -0.14]} castShadow>
        <boxGeometry args={[discRadius * 0.3, discRadius * 0.48, width * 0.22]} />
        <meshStandardMaterial color="#d71935" metalness={0.58} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function ProceduralWheel({
  position,
  quaternion,
  radius,
  width,
  mode,
  opacity = 1,
  name,
}: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  width: number;
  mode: CadViewMode;
  opacity?: number;
  name: string;
}) {
  const technical = mode === "technical";
  const sidewall = Math.min(radius * 0.22, Math.max(radius * 0.14, width * 0.3));
  const rimRadius = Math.max(radius - 2.05 * sidewall, radius * 0.48);
  const rimWidth = width * 0.8;
  const tireMajorRadius = Math.max(radius - sidewall, 0.01);
  const tireDepthScale = width / Math.max(sidewall * 2, 0.001);

  return (
    <group name={name} position={position} quaternion={quaternion}>
      <mesh scale={[1, 1, tireDepthScale]} castShadow={!technical} receiveShadow>
        <torusGeometry args={[tireMajorRadius, sidewall, 14, 48]} />
        <meshStandardMaterial
          color={technical ? "#687587" : "#171a1f"}
          roughness={technical ? 0.45 : 0.88}
          metalness={technical ? 0.4 : 0.03}
          wireframe={technical}
          transparent={technical || opacity < 1}
          opacity={technical ? 0.5 * opacity : opacity}
        />
      </mesh>

      {!technical && opacity >= 0.5 && <WheelTread radius={radius} width={width} />}

      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!technical} receiveShadow>
        <cylinderGeometry args={[rimRadius, rimRadius, rimWidth, 32, 1, true]} />
        <meshStandardMaterial
          color="#707b88"
          metalness={0.94}
          roughness={0.18}
          wireframe={technical}
          transparent={technical || opacity < 1}
          opacity={technical ? 0.45 * opacity : opacity}
          side={DoubleSide}
        />
      </mesh>
      {[-rimWidth / 2, rimWidth / 2].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[rimRadius * 0.97, rimRadius * 0.035, 8, 40]} />
          <meshStandardMaterial color="#c4ccd6" metalness={0.96} roughness={0.14} wireframe={technical} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ))}

      {!technical && opacity >= 0.5 && <>
        <RimSpokes rimRadius={rimRadius} width={rimWidth} />
        <BrakeAssembly rimRadius={rimRadius} width={rimWidth} />
      </>}

      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!technical}>
        <cylinderGeometry args={[rimRadius * 0.21, rimRadius * 0.21, rimWidth * 0.58, 24]} />
        <meshStandardMaterial color="#68727e" metalness={0.95} roughness={0.16} wireframe={technical} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0, rimWidth * 0.32]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[rimRadius * 0.105, rimRadius * 0.105, rimWidth * 0.08, 20]} />
        <meshStandardMaterial color="#d7dde5" metalness={0.92} roughness={0.14} transparent={opacity < 1} opacity={opacity} />
      </mesh>
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

  return (
    <group name={`cad-assembly-${assemblyId}`}>
      {showMechanism && LINKS.map((link) => {
        if (!visibility[link.group]) return null;
        const start = positionFor(link.start);
        const end = positionFor(link.end);
        return (
          <group key={`${assemblyId}-${link.id}`}>
            {showDetailed && (
              <TubeBetween
                start={start}
                end={end}
                radius={LINK_RADII[link.group]}
                color={LINK_COLORS[link.group]}
                opacity={opacity}
              />
            )}
            {showTechnical && (
              <Line
                points={[start, end]}
                color={LINK_COLORS[link.group]}
                lineWidth={mode === "technical" ? 2.2 : 1}
                transparent={opacity < 1 || mode === "hybrid"}
                opacity={mode === "hybrid" ? 0.65 * opacity : opacity}
              />
            )}
          </group>
        );
      })}

      {showMechanism && visibility.hardpoints && hardpointIds.map((id) => (
        <Joint
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
