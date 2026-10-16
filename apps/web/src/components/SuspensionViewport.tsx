import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import type { KinematicPose, Vec3 } from "@msku/contracts";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { mirrorAcrossVehicleCentreline, pointMap, staticWheelAxis, toThreePosition } from "../domain/geometry";
import { useWorkspace, type CameraPreset } from "../store/workspace";
import { ProceduralCadAssembly } from "./ProceduralCadAssembly";

const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  perspective: [1.15, 0.8, 1.35],
  isometric: [1.15, 0.8, 1.35],
  front: [1.8, 0.35, -0.5],
  rear: [-1.8, 0.35, -0.5],
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
  hardpointOverrides?: Record<string, Vec3>;
}

function SuspensionModel({ mirrored = false, pose, hardpointOverrides }: ModelProps) {
  const project = useWorkspace((state) => state.project);
  const selectedId = useWorkspace((state) => state.selectedHardpointId);
  const select = useWorkspace((state) => state.setSelectedHardpoint);
  const visibility = useWorkspace((state) => state.visibility);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const points = useMemo(() => pointMap(project.suspension.hardpoints), [project.suspension.hardpoints]);

  const positionFor = (id: string): [number, number, number] => {
    const point = points.get(id);
    if (!point) throw new Error(`Hardpoint ${id} is missing from the viewport model.`);
    const calculated = pose?.hardpoints[id] ?? hardpointOverrides?.[id] ?? point.position;
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
      <ProceduralCadAssembly
        assemblyId={mirrored ? "ayna" : "etkin-kose"}
        hardpointIds={project.suspension.hardpoints.map((point) => point.id)}
        positionFor={positionFor}
        wheelPosition={positionFor("wheel_center")}
        wheelQuaternion={wheelQuaternion}
        wheelRadius={project.suspension.wheel.radius}
        wheelWidth={project.suspension.wheel.width}
        visibility={visibility}
        mode={cadMode}
        selectedHardpointId={mirrored ? undefined : selectedId}
        onSelectHardpoint={mirrored ? undefined : select}
        opacity={mirrored ? 0.2 : 1}
      />
    </group>
  );
}

export function SuspensionViewport({
  pose,
  mode = "geometry",
  forceVectors = [],
  hardpointOverrides,
}: {
  pose?: KinematicPose;
  mode?: "geometry" | "kinematics" | "loads" | "optimization";
  hardpointOverrides?: Record<string, Vec3>;
  forceVectors?: Array<{
    id: string;
    origin: { x: number; y: number; z: number };
    force: { x: number; y: number; z: number };
  }>;
}) {
  const cameraPreset = useWorkspace((state) => state.cameraPreset);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const mirror = useWorkspace((state) => state.visibility.mirror);
  const maximumForce = Math.max(
    ...forceVectors.map(({ force }) => Math.hypot(force.x, force.y, force.z)),
    0,
  );

  return (
    <div className={`viewport ${mode}`} data-testid="suspension-viewport" data-cad-mode={cadMode}>
      <Canvas shadows camera={{ position: CAMERA_POSITIONS.perspective, fov: 38, near: 0.01, far: 100 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={["#080a0e"]} />
        <fog attach="fog" args={["#080a0e", 2.5, 7]} />
        <ambientLight intensity={0.46} />
        <hemisphereLight args={["#e7edf5", "#16191d", 0.74]} />
        <directionalLight castShadow position={[1.8, 2.8, 1.6]} intensity={1.85} color="#f4f6f8" shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <directionalLight position={[-1.4, 1.1, -1.6]} intensity={0.48} color="#9aa9b8" />
        <spotLight position={[0.2, 2.8, -2.1]} intensity={0.72} angle={0.55} penumbra={0.82} color="#d7e1eb" />
        <gridHelper args={[2, 20, "#29303d", "#171b23"]} position={[0, 0, 0]} />
        <SuspensionModel pose={pose} hardpointOverrides={hardpointOverrides} />
        {maximumForce > 0 && forceVectors.map(({ id, origin, force }) => {
          const magnitude = Math.hypot(force.x, force.y, force.z);
          if (magnitude <= 1e-12) return null;
          const direction = new Vector3(force.x, force.z, -force.y).normalize();
          const arrowOrigin = new Vector3(origin.x, origin.z, -origin.y);
          const length = 0.08 + 0.24 * magnitude / maximumForce;
          return (
            <arrowHelper
              key={id}
              args={[direction, arrowOrigin, length, "#f59e0b", Math.min(0.055, length * 0.28), 0.028]}
            />
          );
        })}
        {mirror && <SuspensionModel mirrored pose={pose} hardpointOverrides={hardpointOverrides} />}
        <ContactShadows position={[0, 0.002, -0.48]} scale={2.2} opacity={0.3} blur={2.8} far={1.4} resolution={512} />
        <CameraRig preset={cameraPreset} />
        <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
          <GizmoViewport axisColors={["#ef233c", "#6ee7b7", "#60a5fa"]} labelColor="#f8fafc" />
        </GizmoHelper>
      </Canvas>
      <div className="viewport-legend">
        <span><i className="axis x" />X ileri</span>
        <span><i className="axis y" />Y sol</span>
        <span><i className="axis z" />Z yukarı</span>
        <span>İç birim: m · Düzenleyici: mm</span>
        <span>CAD görünümü: {cadMode === "technical" ? "Teknik" : cadMode === "detailed" ? "Detaylı" : "Karma"}</span>
        {mirror && <span>AYNA VARSAYIMI · yalnızca görselleştirme</span>}
        {mode === "loads" && <span>Kuvvet okları: göreli ölçek · değerler tabloda</span>}
      </div>
    </div>
  );
}

