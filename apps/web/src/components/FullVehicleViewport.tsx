import { ContactShadows, GizmoHelper, GizmoViewport, Html, Line, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import type { CornerId, FullCarSample, KinematicPose, Project, Suspension, Vec3 } from "@msku/contracts";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { staticWheelAxis, toThreePosition } from "../domain/geometry";
import {
  CORNER_IDS,
  cornerIndex,
  cornerPointToVehicle,
  cornerWheelPosition,
  fullCarVisualState,
  visibleCornerIds,
} from "../domain/vehicle";
import { uiCorner, uiStatus } from "../lib/uiText";
import { useKinematics } from "../store/kinematics";
import { useWorkspace, type CadViewMode, type CameraPreset, type VehicleViewMode, type VisibilityState } from "../store/workspace";
import { CadTube, ProceduralCadAssembly } from "./ProceduralCadAssembly";

const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  perspective: [3.05, 1.7, 2.3],
  isometric: [3.0, 2.25, 2.75],
  front: [3.5, 0.65, 0],
  rear: [-3.5, 0.65, 0],
  side: [0, 0.75, 3.8],
  top: [0.01, 4.2, 0],
};

const VIEW_MODE_LABELS: Record<VehicleViewMode, string> = {
  full_vehicle: "TAM ARAÇ",
  front_axle: "ÖN AKS",
  rear_axle: "ARKA AKS",
  active_corner: "ETKİN KÖŞE",
  chassis_cg: "ŞASİ VE AĞIRLIK MERKEZİ",
  suspension: "SÜSPANSİYON",
  kinematics: "KİNEMATİK",
  dynamics: "DİNAMİK",
};

const cornerLabel = (cornerId: CornerId): string => ({
  front_left: "FL",
  front_right: "FR",
  rear_left: "RL",
  rear_right: "RR",
})[cornerId];

function VehicleCameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  useEffect(() => {
    camera.position.set(...CAMERA_POSITIONS[preset]);
    camera.up.set(0, 1, 0);
    controls.current?.target.set(0, 0.28, 0);
    controls.current?.update();
  }, [camera, preset]);
  return <OrbitControls ref={controls} makeDefault target={[0, 0.28, 0]} minDistance={0.55} maxDistance={9} />;
}

const rotateAxisForSteering = (axis: Vec3, steeringRad: number): Vec3 => ({
  x: Math.cos(steeringRad) * axis.x - Math.sin(steeringRad) * axis.y,
  y: Math.sin(steeringRad) * axis.x + Math.cos(steeringRad) * axis.y,
  z: axis.z,
});

export function VehicleCornerAssembly({
  project,
  cornerId,
  visibility,
  pose,
  wheelZOffsetM = 0,
  steeringRad = 0,
  showMechanism = true,
  cadMode,
  visualModelSource,
  showRepresentativeActuation = false,
}: {
  project: Project;
  cornerId: CornerId;
  visibility: VisibilityState;
  pose?: KinematicPose;
  wheelZOffsetM?: number;
  steeringRad?: number;
  showMechanism?: boolean;
  cadMode: CadViewMode;
  visualModelSource: "glb" | "procedural";
  showRepresentativeActuation?: boolean;
}) {
  const corner = project.vehicle.corners[cornerId];
  const suspension: Suspension = corner.suspension;
  const points = useMemo(
    () => new Map(suspension.hardpoints.map((point) => [point.id, point.position])),
    [suspension.hardpoints],
  );

  const vehiclePoint = (id: string): [number, number, number] => {
    const source = pose?.hardpoints[id] ?? points.get(id);
    if (!source) throw new Error(`Corner ${cornerId} is missing ${id}.`);
    return toThreePosition(cornerPointToVehicle(project, cornerId, source));
  };

  const staticVehiclePoint = (id: string): [number, number, number] => {
    const source = points.get(id);
    if (!source) throw new Error(`Corner ${cornerId} is missing ${id}.`);
    return toThreePosition(cornerPointToVehicle(project, cornerId, source));
  };

  const actuationVehiclePoint = (point: Vec3): [number, number, number] =>
    toThreePosition(cornerPointToVehicle(project, cornerId, point));

  const wheelCentre = cornerWheelPosition(project, cornerId);
  const solvedCentre = pose?.hardpoints.wheel_center;
  const wheelPosition = solvedCentre
    ? cornerPointToVehicle(project, cornerId, solvedCentre)
    : { ...wheelCentre, z: wheelCentre.z + wheelZOffsetM };
  const wheelQuaternion = useMemo((): [number, number, number, number] => {
    const source = pose?.wheelAxis ?? staticWheelAxis(
      cornerId,
      suspension.wheel.staticCamberRad,
      suspension.wheel.staticToeRad,
    );
    const steered = rotateAxisForSteering(source, cornerId.startsWith("front") ? steeringRad : 0);
    const threeAxis = new Vector3(steered.x, steered.z, -steered.y).normalize();
    const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), threeAxis);
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
  }, [cornerId, pose, steeringRad, suspension.wheel.staticCamberRad, suspension.wheel.staticToeRad]);

  return (
    <group name={`corner-${cornerId}`}>
      <ProceduralCadAssembly
        assemblyId={cornerId}
        hardpointIds={suspension.hardpoints.map((point) => point.id)}
        positionFor={vehiclePoint}
        staticPositionFor={staticVehiclePoint}
        wheelPosition={toThreePosition(wheelPosition)}
        wheelQuaternion={wheelQuaternion}
        wheelRadius={suspension.wheel.radius}
        wheelWidth={suspension.wheel.width}
        visibility={visibility}
        mode={cadMode}
        showMechanism={showMechanism}
        showRepresentativeActuation={showRepresentativeActuation}
        visualModelSource={visualModelSource}
        importedAssetMirrored={cornerId.endsWith("right")}
        actuation={suspension.actuation}
        actuationPointFor={actuationVehiclePoint}
      />
      {visibility.labels && visualModelSource === "procedural" && (
        <Html position={toThreePosition({ ...wheelPosition, z: wheelPosition.z + suspension.wheel.radius + 0.07 })} center>
          <span className="scene-label">{cornerLabel(cornerId)} · {uiStatus(corner.geometrySource)}</span>
        </Html>
      )}
    </group>
  );
}

function ChassisReference({ project, heaveM, pitchRad, rollRad, visible, cadMode }: {
  project: Project;
  heaveM: number;
  pitchRad: number;
  rollRad: number;
  visible: boolean;
  cadMode: CadViewMode;
}) {
  if (!visible) return null;
  const halfLength = project.vehicle.wheelbaseM * 0.42;
  const halfWidth = Math.max(project.vehicle.frontTrackM, project.vehicle.rearTrackM) * 0.27;
  const lowerZ = 0.16;
  const upperZ = 0.48;
  const vertices: Vec3[] = [
    { x: halfLength, y: halfWidth, z: lowerZ }, { x: halfLength, y: -halfWidth, z: lowerZ },
    { x: -halfLength, y: halfWidth, z: lowerZ }, { x: -halfLength, y: -halfWidth, z: lowerZ },
    { x: halfLength, y: halfWidth, z: upperZ }, { x: halfLength, y: -halfWidth, z: upperZ },
    { x: -halfLength, y: halfWidth, z: upperZ }, { x: -halfLength, y: -halfWidth, z: upperZ },
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const showTechnical = cadMode !== "detailed";
  const showDetailed = cadMode !== "technical";
  return (
    <group position={[0, heaveM, 0]} rotation={[rollRad, 0, -pitchRad]} name="reference-chassis-envelope">
      {edges.map(([start, end]) => (
        <group key={`${start}-${end}`}>
          {showDetailed && <CadTube start={toThreePosition(vertices[start])} end={toThreePosition(vertices[end])} radius={0.014} color="#667180" metalness={0.78} roughness={0.3} />}
          {showTechnical && <Line points={[toThreePosition(vertices[start]), toThreePosition(vertices[end])]} color="#8f9baa" lineWidth={cadMode === "technical" ? 2 : 1} transparent opacity={cadMode === "hybrid" ? 0.65 : 1} />}
        </group>
      ))}
      {showDetailed && <mesh position={[0, lowerZ + 0.008, 0]} receiveShadow castShadow>
        <boxGeometry args={[halfLength * 1.88, 0.022, halfWidth * 1.76]} />
        <meshStandardMaterial color="#20262f" metalness={0.26} roughness={0.66} transparent opacity={0.18} depthWrite={false} />
      </mesh>}
      <mesh position={toThreePosition(project.vehicle.cgPositionM)} name="configured-cg" castShadow>
        <sphereGeometry args={[0.045, 20, 20]} />
        <meshStandardMaterial color="#f59e0b" emissive="#5f3500" />
      </mesh>
      <Html position={toThreePosition({ ...project.vehicle.cgPositionM, z: project.vehicle.cgPositionM.z + 0.09 })} center>
        <span className="scene-label cg">Ağırlık merkezi · yapılandırıldı</span>
      </Html>
    </group>
  );
}

function AxleReferences({ project }: { project: Project }) {
  return <>
    {(["front", "rear"] as const).map((axle) => {
      const x = (axle === "front" ? 1 : -1) * project.vehicle.wheelbaseM / 2;
      const track = axle === "front" ? project.vehicle.frontTrackM : project.vehicle.rearTrackM;
      return <Line key={axle} points={[toThreePosition({ x, y: -track / 2, z: 0.02 }), toThreePosition({ x, y: track / 2, z: 0.02 })]} color={axle === "front" ? "#ef233c" : "#60a5fa"} lineWidth={1} dashed dashSize={0.04} gapSize={0.025} />;
    })}
    <Line points={[toThreePosition({ x: -project.vehicle.wheelbaseM / 2, y: 0, z: 0.015 }), toThreePosition({ x: project.vehicle.wheelbaseM / 2, y: 0, z: 0.015 })]} color="#6ee7b7" lineWidth={1} dashed dashSize={0.05} gapSize={0.03} />
  </>;
}

export function FullVehicleViewport({
  fullCarSample,
  bicycleYawRad = 0,
  steeringRad = 0,
  bicycleResultAvailable = false,
}: {
  fullCarSample?: FullCarSample;
  bicycleYawRad?: number;
  steeringRad?: number;
  bicycleResultAvailable?: boolean;
}) {
  const project = useWorkspace((state) => state.project);
  const preset = useWorkspace((state) => state.cameraPreset);
  const mode = useWorkspace((state) => state.vehicleViewMode);
  const visibility = useWorkspace((state) => state.visibility);
  const cadMode = useWorkspace((state) => state.cadViewMode);
  const visualModelSource = useWorkspace((state) => state.visualModelSource);
  const glbProgress = useProgress();
  const glbReady = visualModelSource !== "glb"
    || (glbProgress.total > 0 && glbProgress.loaded === glbProgress.total && !glbProgress.active);
  const sceneSurface = cadMode === "detailed"
    ? { background: "#d9dde0", fog: "#d9dde0", gridMajor: "#747c83", gridMinor: "#b8bec3" }
    : { background: "#080a0e", fog: "#080a0e", gridMajor: "#303846", gridMinor: "#171c24" };
  const sweep = useKinematics((state) => state.sweep);
  const selectedIndex = useKinematics((state) => state.selectedIndex);
  const solvedCornerId = useKinematics((state) => state.solvedCornerId);
  const kinematicState = sweep?.states[selectedIndex];
  const kinematicPose = mode === "kinematics"
    && solvedCornerId === project.activeCornerId
    && kinematicState?.calculationStatus === "VERIFIED_NUMERICALLY"
    ? kinematicState.pose ?? undefined
    : undefined;
  const dynamics = fullCarVisualState(mode === "dynamics" ? fullCarSample : undefined);
  const corners = visibleCornerIds(mode, project.activeCornerId);
  const hasUnmountedCoiloverPreview = corners.some(
    (cornerId) => !project.vehicle.corners[cornerId].suspension.actuation,
  );
  const coiloverStatus = visualModelSource !== "glb" || !visibility.coilover
    ? "HIDDEN"
    : hasUnmountedCoiloverPreview
      ? "UNMOUNTED_COMPONENT_PREVIEW"
      : "DECLARED_STATIC_GEOMETRY";
  const showMechanism = mode !== "dynamics";
  const bodyVisible = visibility.chassis && mode !== "suspension" && mode !== "kinematics";
  const blockedReason = mode === "kinematics" && !kinematicPose
    ? `${uiCorner(project.activeCornerId)} için kabul edilmiş kinematik konum yok. Önce bu köşenin çözücüsünü çalıştırın.`
    : mode === "dynamics" && !fullCarSample && !bicycleResultAvailable
      ? "Kabul edilmiş tam araç veya bisiklet modeli sonucu yok. Önce desteklenen bir Faz 5 dinamik modelini çalıştırın."
      : null;

  return (
    <div
      className="full-vehicle-viewport"
      data-testid="full-vehicle-viewport"
      data-cad-mode={cadMode}
      data-visual-model-source={visualModelSource}
      data-glb-ready={glbReady}
      data-coilover-status={coiloverStatus}
      data-coilover-count={coiloverStatus === "HIDDEN" ? 0 : corners.length}
    >
      <Canvas shadows camera={{ position: CAMERA_POSITIONS.perspective, fov: 36, near: 0.01, far: 100 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={[sceneSurface.background]} />
        <fog attach="fog" args={[sceneSurface.fog, 5.5, 13]} />
        <ambientLight intensity={0.44} />
        <hemisphereLight args={["#e8edf4", "#15181c", 0.76]} />
        <directionalLight castShadow position={[3.5, 4.8, 2.8]} intensity={1.9} color="#f4f6f8" shadow-mapSize-width={1536} shadow-mapSize-height={1536} />
        <directionalLight position={[-2.5, 1.4, -3]} intensity={0.5} color="#9ba9b7" />
        <spotLight position={[0, 4.8, -3.2]} intensity={0.78} angle={0.52} penumbra={0.84} color="#d8e1eb" />
        {visibility.referencePlanes && <>
          <gridHelper args={[6, 60, sceneSurface.gridMajor, sceneSurface.gridMinor]} position={[0, 0, 0]} />
          <AxleReferences project={project} />
        </>}
        <group rotation={[0, bicycleYawRad, 0]}>
          <ChassisReference
            project={project}
            heaveM={dynamics.bodyHeaveM}
            pitchRad={dynamics.pitchRad}
            rollRad={dynamics.rollRad}
            visible={bodyVisible}
            cadMode={cadMode}
          />
          {corners.map((cornerId) => (
            <VehicleCornerAssembly
              key={cornerId}
              project={project}
              cornerId={cornerId}
              visibility={visibility}
              pose={cornerId === project.activeCornerId ? kinematicPose : undefined}
              wheelZOffsetM={dynamics.unsprungDisplacementsM[cornerIndex(cornerId)]}
              steeringRad={steeringRad}
              showMechanism={showMechanism}
              cadMode={cadMode}
              visualModelSource={visualModelSource}
              showRepresentativeActuation={showMechanism && visibility.representativeActuation && (visualModelSource === "glb" || cornerId === project.activeCornerId)}
            />
          ))}
        </group>
        <ContactShadows position={[0, 0.002, 0]} scale={6} opacity={0.28} blur={3} far={2.3} resolution={512} />
        <VehicleCameraRig preset={preset} />
        <GizmoHelper alignment="bottom-right" margin={[74, 74]}>
          <GizmoViewport axisColors={["#ef233c", "#6ee7b7", "#60a5fa"]} labelColor="#f8fafc" />
        </GizmoHelper>
      </Canvas>
      <div className="scene-manifest" aria-label="Tam araç sahne bileşenleri">
        {CORNER_IDS.map((cornerId) => {
          const point = cornerWheelPosition(project, cornerId);
          return <span
            key={cornerId}
            data-testid={`wheel-assembly-${cornerId.replace("_", "-")}`}
            data-x={point.x}
            data-y={point.y}
            data-z={point.z + dynamics.unsprungDisplacementsM[cornerIndex(cornerId)]}
          />;
        })}
        {showMechanism && visibility.representativeActuation && (
          <span
            data-testid="representative-actuation-layer"
            data-status="UNSUPPORTED_STATIC_REFERENCE"
            data-corner={project.activeCornerId}
          />
        )}
      </div>
      <div className="full-vehicle-badge">DÖRT KÖŞE MODELİ · {VIEW_MODE_LABELS[mode]} · {cadMode === "technical" ? "TEKNİK" : cadMode === "detailed" ? "DETAYLI" : "KARMA"} · {visualModelSource === "glb" ? "GLB" : "PROSEDÜREL"}</div>
      <div className="reference-disclaimer">Şasi zarfı ve aks çizgileri yalnızca referanstır — sağlanmamış bağlantı veya çalıştırma geometrisi varsayılmaz.</div>
      {visualModelSource === "glb" && <div className="solver-motion-note">İçe aktarılan GLB parçaları mevcut tekerlek ölçüsü ve hardpoint açıklığına görsel olarak ölçeklenmiştir; üretim boyutu veya MSKU Racing fiziksel parça doğrulaması değildir.</div>}
      {coiloverStatus === "UNMOUNTED_COMPONENT_PREVIEW" && <div className="representative-layer-note">COILOVER ÖNİZLEMESİ · MONTAJ VERİSİ YOK — upright pickup, rocker ekseni/pickup ve şasi damper noktaları sağlanmadığı için bağlantısız gösterilir</div>}
      {visualModelSource === "glb" && !glbReady && <div className="representative-layer-note">GLB parçaları yükleniyor · %{Math.round(glbProgress.progress)}</div>}
      {mode === "dynamics" && fullCarSample && <div className="solver-motion-note">7 serbestlik dereceli çözücü örneği · şasi yükselme/başvurma/yalpa + dört yaylanmayan kütle geçmişi · bağlantı kapanışı bu modelde bulunmadığı için süspansiyon kolları gizlendi.</div>}
      {mode === "dynamics" && !fullCarSample && bicycleResultAvailable && <div className="solver-motion-note">Bisiklet modeli çözücüsü · sapma yönelimi hesaplanan sapma hızından trapez yöntemiyle tümleştirilir; ön tekerlek yönlendirmesi sağlanan direksiyon geçmişini kullanır.</div>}
      {showMechanism && visibility.representativeActuation && <div className="representative-layer-note">TEMSİLİ PUSHROD/ROCKER — bağlantı verisi yok, hareketsiz ve mühendislik sonucu değildir</div>}
      {blockedReason && <div className="vehicle-blocked">{blockedReason}</div>}
    </div>
  );
}
