import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import type { CoiloverSample, KinematicPose, Phase3CalculationStatus, Vec3 } from "@msku/contracts";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { mirrorAcrossVehicleCentreline, pointMap, staticWheelAxis, toThreePosition } from "../domain/geometry";
import { solveActuationKinematics } from "../domain/actuationKinematics";
import { useWorkspace, type CameraPreset } from "../store/workspace";
import { ProceduralCadAssembly } from "./ProceduralCadAssembly";

const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  perspective: [0.76, 0.62, 0.18],
  isometric: [0.96, 0.82, 0.34],
  front: [1.8, 0.35, -0.5],
  rear: [-1.8, 0.35, -0.5],
  side: [0.0, 0.35, 1.8],
  top: [0.0, 2.1, -0.5],
};

const UPRIGHT_INSPECTION_TARGET: [number, number, number] = [0, 0.29, -0.68];

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    camera.position.set(...CAMERA_POSITIONS[preset]);
    camera.up.set(0, 1, 0);
    controls.current?.target.set(...UPRIGHT_INSPECTION_TARGET);
    controls.current?.update();
  }, [camera, preset]);

  return <OrbitControls ref={controls} makeDefault target={UPRIGHT_INSPECTION_TARGET} minDistance={0.28} maxDistance={4} />;
}

interface ModelProps {
  mirrored?: boolean;
  pose?: KinematicPose;
  hardpointOverrides?: Record<string, Vec3>;
  coiloverPhysics?: CoiloverSample;
}

function SuspensionModel({ mirrored = false, pose, hardpointOverrides, coiloverPhysics }: ModelProps) {
  const project = useWorkspace((state) => state.project);
  const selectedId = useWorkspace((state) => state.selectedHardpointId);
  const select = useWorkspace((state) => state.setSelectedHardpoint);
  const visibility = useWorkspace((state) => state.visibility);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const visualModelSource = useWorkspace((state) => state.visualModelSource);
  const points = useMemo(() => pointMap(project.suspension.hardpoints), [project.suspension.hardpoints]);

  const positionFor = (id: string): [number, number, number] => {
    const point = points.get(id);
    if (!point) throw new Error(`Hardpoint ${id} is missing from the viewport model.`);
    const calculated = pose?.hardpoints[id] ?? hardpointOverrides?.[id] ?? point.position;
    const value = mirrored ? mirrorAcrossVehicleCentreline(calculated) : calculated;
    return toThreePosition(value);
  };

  const staticPositionFor = (id: string): [number, number, number] => {
    const point = points.get(id);
    if (!point) throw new Error(`Hardpoint ${id} is missing from the viewport model.`);
    const stored = hardpointOverrides?.[id] ?? point.position;
    return toThreePosition(mirrored ? mirrorAcrossVehicleCentreline(stored) : stored);
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

  const actuationPointFor = (point: Vec3): [number, number, number] => {
    const value = mirrored ? mirrorAcrossVehicleCentreline(point) : point;
    return toThreePosition(value);
  };

  return (
    <group>
      <ProceduralCadAssembly
        assemblyId={mirrored ? "ayna" : "etkin-kose"}
        hardpointIds={project.suspension.hardpoints.map((point) => point.id)}
        positionFor={positionFor}
        staticPositionFor={staticPositionFor}
        wheelPosition={positionFor("wheel_center")}
        wheelQuaternion={wheelQuaternion}
        wheelRadius={project.suspension.wheel.radius}
        wheelWidth={project.suspension.wheel.width}
        visibility={visibility}
        mode={cadMode}
        selectedHardpointId={mirrored ? undefined : selectedId}
        onSelectHardpoint={mirrored ? undefined : select}
        showRepresentativeActuation={!mirrored && visibility.representativeActuation && !project.suspension.actuation}
        visualModelSource={visualModelSource}
        importedAssetMirrored={project.suspension.corner.endsWith("right") !== mirrored}
        actuation={project.suspension.actuation}
        staticWheelCenter={points.get("wheel_center")!.position}
        actuationPointFor={actuationPointFor}
        kinematicPose={pose}
        coiloverPhysics={coiloverPhysics}
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
  coiloverPhysics,
  coiloverPhysicsStatus,
  coiloverPhysicsWarning,
}: {
  pose?: KinematicPose;
  mode?: "geometry" | "kinematics" | "loads" | "optimization";
  hardpointOverrides?: Record<string, Vec3>;
  forceVectors?: Array<{
    id: string;
    origin: { x: number; y: number; z: number };
    force: { x: number; y: number; z: number };
  }>;
  coiloverPhysics?: CoiloverSample;
  coiloverPhysicsStatus?: Phase3CalculationStatus;
  coiloverPhysicsWarning?: string;
}) {
  const cameraPreset = useWorkspace((state) => state.cameraPreset);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const visualModelSource = useWorkspace((state) => state.visualModelSource);
  const glbProgress = useProgress();
  const glbReady = visualModelSource !== "glb"
    || (glbProgress.total > 0 && glbProgress.loaded === glbProgress.total && !glbProgress.active);
  const mirror = useWorkspace((state) => state.visibility.mirror);
  const chassisVisible = useWorkspace((state) => state.visibility.chassis);
  const wheelVisible = useWorkspace((state) => state.visibility.wheel);
  const tireVisible = useWorkspace((state) => state.visibility.tire);
  const rimVisible = useWorkspace((state) => state.visibility.rim);
  const brakeVisible = useWorkspace((state) => state.visibility.brake);
  const brakeDiscVisible = useWorkspace((state) => state.visibility.brakeDisc);
  const caliperVisible = useWorkspace((state) => state.visibility.caliper);
  const hubVisible = useWorkspace((state) => state.visibility.hub);
  const coiloverVisible = useWorkspace((state) => state.visibility.coilover);
  const uprightVisible = useWorkspace((state) => state.visibility.upright);
  const upperVisible = useWorkspace((state) => state.visibility.upper);
  const lowerVisible = useWorkspace((state) => state.visibility.lower);
  const steeringVisible = useWorkspace((state) => state.visibility.steering);
  const referencePlanesVisible = useWorkspace((state) => state.visibility.referencePlanes);
  const representativeVisible = useWorkspace((state) => state.visibility.representativeActuation);
  const project = useWorkspace((state) => state.project);
  const activeActuation = project.suspension.actuation;
  const staticWheelCenter = project.suspension.hardpoints.find((point) => point.id === "wheel_center")?.position;
  const actuationResult = activeActuation && staticWheelCenter
    ? solveActuationKinematics(activeActuation, staticWheelCenter, pose)
    : undefined;
  const coiloverStatus = visualModelSource !== "glb" || !coiloverVisible
    ? "HIDDEN"
    : !actuationResult
      ? "MISSING_ACTUATION_HARDPOINTS"
      : actuationResult.status === "FAILED"
        ? "FAILED_ACTUATION_KINEMATICS"
        : "SOLVED_ACTUATION_GEOMETRY";
  const mechanicalAssemblyActive = !tireVisible
    && !rimVisible
    && uprightVisible
    && upperVisible
    && lowerVisible
    && steeringVisible
    && brakeDiscVisible
    && caliperVisible
    && hubVisible;
  const sceneSurface = cadMode === "detailed"
    ? { background: "#d9dde0", fog: "#d9dde0", gridMajor: "#737b82", gridMinor: "#b7bdc2" }
    : { background: "#080a0e", fog: "#080a0e", gridMajor: "#29303d", gridMinor: "#171b23" };
  const maximumForce = Math.max(
    ...forceVectors.map(({ force }) => Math.hypot(force.x, force.y, force.z)),
    0,
  );

  return (
    <div
      className={`viewport ${mode}`}
      data-testid="suspension-viewport"
      data-cad-mode={cadMode}
      data-visual-model-source={visualModelSource}
      data-glb-ready={glbReady}
      data-tire-visible={wheelVisible && tireVisible}
      data-rim-visible={wheelVisible && rimVisible}
      data-brake-disc-visible={wheelVisible && brakeVisible && brakeDiscVisible}
      data-caliper-visible={wheelVisible && brakeVisible && caliperVisible}
      data-hub-visible={wheelVisible && hubVisible}
      data-reference-plane-visible={referencePlanesVisible}
      data-mechanical-assembly-active={mechanicalAssemblyActive}
      data-coilover-status={coiloverStatus}
      data-rocker-angle-rad={actuationResult?.status === "SOLVED" ? actuationResult.rockerAngleRad : undefined}
      data-coilover-length-m={actuationResult?.status === "SOLVED" ? actuationResult.coiloverLengthM : undefined}
      data-pushrod-residual-m={actuationResult?.status === "SOLVED" ? actuationResult.pushrodResidualM : undefined}
      data-coilover-physics-status={coiloverPhysicsStatus}
      data-coilover-spring-force-n={coiloverPhysics?.springForceN}
      data-coilover-damper-force-n={coiloverPhysics?.damperForceN}
      data-coilover-total-force-n={coiloverPhysics?.totalAxialForceN}
      data-coilover-motion-ratio={coiloverPhysics?.motionRatio}
      data-coilover-physics-warning={coiloverPhysicsWarning}
    >
      <Canvas shadows camera={{ position: CAMERA_POSITIONS.perspective, fov: 33, near: 0.01, far: 100 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={[sceneSurface.background]} />
        <fog attach="fog" args={[sceneSurface.fog, 2.5, 7]} />
        <ambientLight intensity={0.46} />
        <hemisphereLight args={["#e7edf5", "#16191d", 0.74]} />
        <directionalLight castShadow position={[1.8, 2.8, 1.6]} intensity={1.85} color="#f4f6f8" shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <directionalLight position={[-1.4, 1.1, -1.6]} intensity={0.48} color="#9aa9b8" />
        <spotLight position={[0.2, 2.8, -2.1]} intensity={0.72} angle={0.55} penumbra={0.82} color="#d7e1eb" />
        {referencePlanesVisible && <gridHelper args={[2, 20, sceneSurface.gridMajor, sceneSurface.gridMinor]} position={[0, 0, 0]} />}
        <SuspensionModel pose={pose} hardpointOverrides={hardpointOverrides} coiloverPhysics={coiloverPhysics} />
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
        {mirror && <SuspensionModel mirrored pose={pose} hardpointOverrides={hardpointOverrides} coiloverPhysics={coiloverPhysics} />}
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
        {mechanicalAssemblyActive && <span>MEKANİK MONTAJ · LASTİK/JANT GİZLİ</span>}
        <span>{visualModelSource === "glb" ? "ÖLÇEĞE UYARLANMIŞ GLB · BOYUTSAL/FİZİKSEL DOĞRULAMA YOK" : "PROSEDÜREL GÖRSEL · BOYUTSAL/FİZİKSEL DOĞRULAMA YOK"}</span>
        {chassisVisible && <span>Şasi/pickup paneli: görsel referans</span>}
        {coiloverStatus === "SOLVED_ACTUATION_GEOMETRY" && <span>GLB COILOVER · İKİ GÖZ ÇÖZÜLMÜŞ ROCKER/ŞASİ NOKTALARINA BAĞLI</span>}
        {coiloverStatus === "SOLVED_ACTUATION_GEOMETRY" && project.dataClassification === "demonstration" && <span>DEMO/SENTETİK AKTÜASYON · GERÇEK ARAÇ/CAD VERİSİ DEĞİL</span>}
        {coiloverPhysicsStatus === "VERIFIED_NUMERICALLY" && coiloverPhysics && <span>COILOVER FİZİĞİ · F={coiloverPhysics.totalAxialForceN.toFixed(1)} N · MR={coiloverPhysics.motionRatio.toFixed(3)}</span>}
        {coiloverPhysicsStatus && coiloverPhysicsStatus !== "VERIFIED_NUMERICALLY" && <span>COILOVER FİZİĞİ ENGELLENDİ · {coiloverPhysicsWarning ?? coiloverPhysicsStatus}</span>}
        {coiloverStatus === "MISSING_ACTUATION_HARDPOINTS" && <span>GLB COILOVER GİZLENDİ · UPRIGHT/ROCKER/ŞASİ MONTAJ HARDPOINT VERİSİ YOK</span>}
        {coiloverStatus === "FAILED_ACTUATION_KINEMATICS" && <span>GLB COILOVER GİZLENDİ · {actuationResult?.status === "FAILED" ? actuationResult.reason : "AKTÜASYON KAPANIŞI ÇÖZÜLEMEDİ"}</span>}
        {visualModelSource === "glb" && chassisVisible && <span>ŞASİ/PICKUP REFERANS PANELİ · ŞASİ CAD'İ DEĞİL</span>}
        {representativeVisible && !activeActuation && <span>TEMSİLİ PUSHROD/ROCKER · veri yok · hareketsiz</span>}
        {mirror && <span>AYNA VARSAYIMI · yalnızca görselleştirme</span>}
        {mode === "loads" && <span>Kuvvet okları: göreli ölçek · değerler tabloda</span>}
      </div>
      {visualModelSource === "glb" && !glbReady && <div className="solver-motion-note">GLB parçaları yükleniyor · %{Math.round(glbProgress.progress)}</div>}
    </div>
  );
}

