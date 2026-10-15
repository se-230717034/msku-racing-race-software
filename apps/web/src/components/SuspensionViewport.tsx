import { GizmoHelper, GizmoViewport, Line, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import type { KinematicPose } from "@msku/contracts";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { LINKS, mirrorAcrossVehicleCentreline, pointMap, staticWheelAxis, toThreePosition } from "../domain/geometry";
import { useWorkspace, type CameraPreset } from "../store/workspace";

const LINK_COLORS = {
  upper: "#e5e7eb",
  lower: "#b8c0cc",
  steering: "#f43f5e",
  upright: "#f8fafc",
  wheel: "#fb7185",
} as const;

const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  perspective: [1.15, 0.8, 1.35],
  front: [1.8, 0.35, -0.5],
  side: [0.0, 0.35, 1.8],
  top: [0.0, 2.1, -0.5],
};

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    camera.position.set(...CAMERA_POSITIONS[preset]);
    camera.up.set(0, 1, 0);
    controls.current?.target.set(0, 0.28, -0.48);
    controls.current?.update();
  }, [camera, preset]);

  return <OrbitControls ref={controls} makeDefault target={[0, 0.28, -0.48]} minDistance={0.35} maxDistance={4} />;
}

interface ModelProps {
  mirrored?: boolean;
  pose?: KinematicPose;
}

function SuspensionModel({ mirrored = false, pose }: ModelProps) {
  const project = useWorkspace((state) => state.project);
  const selectedId = useWorkspace((state) => state.selectedHardpointId);
  const select = useWorkspace((state) => state.setSelectedHardpoint);
  const visibility = useWorkspace((state) => state.visibility);
  const points = useMemo(() => pointMap(project.suspension.hardpoints), [project.suspension.hardpoints]);

  const positionFor = (id: string): [number, number, number] => {
    const point = points.get(id);
    if (!point) throw new Error(`Hardpoint ${id} is missing from the viewport model.`);
    const calculated = pose?.hardpoints[id] ?? point.position;
    const value = mirrored ? mirrorAcrossVehicleCentreline(calculated) : calculated;
    return toThreePosition(value);
  };

  const wheelQuaternion = useMemo((): [number, number, number, number] => {
    const configured = staticWheelAxis(
      project.suspension.corner,
      project.suspension.wheel.staticCamberRad,
      project.suspension.wheel.staticToeRad,
    );
    const source = pose?.wheelAxis ?? configured;
    const vehicleAxis = mirrored ? mirrorAcrossVehicleCentreline(source) : source;
    const threeAxis = new Vector3(vehicleAxis.x, vehicleAxis.z, -vehicleAxis.y).normalize();
    const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), threeAxis);
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
  }, [mirrored, pose, project.suspension.corner, project.suspension.wheel.staticCamberRad, project.suspension.wheel.staticToeRad]);

  return (
    <group>
      {LINKS.map((link) => {
        if (!visibility[link.group]) return null;
        return (
          <Line
            key={`${mirrored ? "mirror" : "primary"}-${link.id}`}
            points={[positionFor(link.start), positionFor(link.end)]}
            color={LINK_COLORS[link.group]}
            lineWidth={mirrored ? 1 : 3}
            transparent={mirrored}
            opacity={mirrored ? 0.22 : 1}
          />
        );
      })}

      {visibility.hardpoints && project.suspension.hardpoints.map((point) => (
        <mesh
          key={`${mirrored ? "mirror" : "primary"}-${point.id}`}
          position={positionFor(point.id)}
          scale={selectedId === point.id && !mirrored ? 1.45 : 1}
          onClick={mirrored ? undefined : (event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            select(point.id);
          }}
        >
          <sphereGeometry args={[0.012, 20, 20]} />
          <meshStandardMaterial
            color={selectedId === point.id && !mirrored ? "#ff304f" : "#f8fafc"}
            transparent={mirrored}
            opacity={mirrored ? 0.25 : 1}
          />
        </mesh>
      ))}

      {visibility.wheel && (
        <mesh position={positionFor("wheel_center")} quaternion={wheelQuaternion}>
          <torusGeometry args={[
            Math.max(project.suspension.wheel.radius - project.suspension.wheel.width / 2, 0.01),
            Math.max(project.suspension.wheel.width / 2, 0.005),
            22,
            64,
          ]} />
          <meshStandardMaterial color="#151922" roughness={0.72} metalness={0.18} transparent opacity={mirrored ? 0.12 : 0.48} />
        </mesh>
      )}
    </group>
  );
}

export function SuspensionViewport({
  pose,
  mode = "geometry",
}: {
  pose?: KinematicPose;
  mode?: "geometry" | "kinematics";
}) {
  const cameraPreset = useWorkspace((state) => state.cameraPreset);
  const mirror = useWorkspace((state) => state.visibility.mirror);

  return (
    <div className={`viewport ${mode}`} data-testid="suspension-viewport">
      <Canvas camera={{ position: CAMERA_POSITIONS.perspective, fov: 38, near: 0.01, far: 100 }} dpr={[1, 2]}>
        <color attach="background" args={["#080a0e"]} />
        <ambientLight intensity={0.72} />
        <directionalLight position={[1.5, 2.5, 1]} intensity={2.2} color="#ffffff" />
        <directionalLight position={[-1, 0.8, -1]} intensity={0.8} color="#ef233c" />
        <gridHelper args={[2, 20, "#29303d", "#171b23"]} position={[0, 0, 0]} />
        <SuspensionModel pose={pose} />
        {mirror && <SuspensionModel mirrored pose={pose} />}
        <CameraRig preset={cameraPreset} />
        <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
          <GizmoViewport axisColors={["#ef233c", "#6ee7b7", "#60a5fa"]} labelColor="#f8fafc" />
        </GizmoHelper>
      </Canvas>
      <div className="viewport-legend">
        <span><i className="axis x" />X forward</span>
        <span><i className="axis y" />Y left</span>
        <span><i className="axis z" />Z up</span>
        <span>Internal: m · Editor: mm</span>
      </div>
    </div>
  );
}

