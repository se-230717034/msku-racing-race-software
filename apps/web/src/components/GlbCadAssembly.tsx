import { useGLTF } from "@react-three/drei";
import type { ActuationGeometry, KinematicPose, Vec3 } from "@msku/contracts";
import { useMemo } from "react";
import {
  Box3,
  BufferGeometry,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

import type { VisibilityState } from "../store/workspace";
import type { CoiloverPlacement } from "./coiloverPlacement";
import type { ThreePosition, ThreeQuaternion } from "./ProceduralCadAssembly";

const MODEL_URLS = {
  brake: "/models/brake.glb",
  coilover: "/models/coilover.glb",
  hub: "/models/hub.glb",
  suspension: "/models/suspension.glb",
  upright: "/models/upright.glb",
  wheel: "/models/wheel.glb",
} as const;

/** Audited GLB bounds in source scene units after imported node transforms. */
export const GLB_SOURCE_DIMENSIONS = {
  wheel: { centre: [0.0102426035, 0, 0] as ThreePosition, radius: 0.37804719, width: 0.30945239 },
  brake: { centre: [-0.0185974904, 0.0028691291, 0.0003738213] as ThreePosition, rotorRadius: 0.16245149 },
  coilover: {
    centre: [0, 0.1338041141, 0] as ThreePosition,
    mountLowY: -0.0326135741,
    mountHighY: 0.3026527921,
    overallLength: 0.3932980169,
    diameter: 0.1072173344,
  },
  hub: { centre: [0, -0.0197582245, 0] as ThreePosition, radius: 22.49011803, width: 40 },
  upright: { centre: [10.3034121831, 0.5226480478, -12.0506870403] as ThreePosition, height: 0.2588151039 },
  suspension: { centre: [56.5582870794, -12.8886999722, -2.7038653624] as ThreePosition, longestSpan: 291.170644174 },
} as const;

const clonedMaterial = (material: Material, opacity: number): Material => {
  const clone = material.clone();
  clone.opacity *= opacity;
  clone.transparent = clone.transparent || opacity < 1;
  if (clone instanceof MeshStandardMaterial) {
    clone.metalness = Math.min(clone.metalness, 0.55);
    clone.roughness = Math.max(clone.roughness, 0.42);
  }
  return clone;
};

const preparedClone = (source: Object3D, opacity = 1): Object3D => {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>;
    const material: Material | Material[] = mesh.material;
    mesh.castShadow = opacity >= 0.5;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(material)
      ? material.map((item) => clonedMaterial(item, opacity))
      : clonedMaterial(material, opacity);
  });
  return clone;
};

const branchVisible = (scene: Object3D, name: string, visible: boolean): void => {
  const branch = scene.getObjectByName(name);
  if (branch) branch.visible = visible;
};

const tuneBranchMaterial = (
  scene: Object3D,
  name: string,
  metalness: number,
  roughness: number,
): void => {
  scene.getObjectByName(name)?.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.metalness = metalness;
      material.roughness = roughness;
    }
  });
};

function ImportedWheel({
  position,
  quaternion,
  radius,
  width,
  mirrored,
  showTire,
  showRim,
  opacity,
}: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  width: number;
  mirrored: boolean;
  showTire: boolean;
  showRim: boolean;
  opacity: number;
}) {
  const source = useGLTF(MODEL_URLS.wheel).scene;
  const scene = useMemo(() => {
    const clone = preparedClone(source, opacity);
    branchVisible(clone, "tire-low", showTire);
    branchVisible(clone, "wheel-full", showRim);
    branchVisible(clone, "brake-caliper", false);
    branchVisible(clone, "brake-disc", false);
    tuneBranchMaterial(clone, "tire-low", 0.02, 0.86);
    tuneBranchMaterial(clone, "wheel-full", 0.42, 0.5);
    return clone;
  }, [opacity, showRim, showTire, source]);
  const radialScale = radius / GLB_SOURCE_DIMENSIONS.wheel.radius;
  const widthScale = width / GLB_SOURCE_DIMENSIONS.wheel.width;
  const mirror = mirrored ? -1 : 1;
  const [cx, cy, cz] = GLB_SOURCE_DIMENSIONS.wheel.centre;
  return (
    <group position={position} quaternion={quaternion} name="glb-tekerlek-katmani">
      <group rotation={[0, -Math.PI / 2, 0]}>
        <group scale={[widthScale, radialScale, radialScale * mirror]}>
          <primitive object={scene} position={[-cx, -cy, -cz]} />
        </group>
      </group>
    </group>
  );
}
function ImportedBrake({
  position,
  quaternion,
  radius,
  mirrored,
  showDisc,
  showCaliper,
  opacity,
}: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  mirrored: boolean;
  showDisc: boolean;
  showCaliper: boolean;
  opacity: number;
}) {
  const source = useGLTF(MODEL_URLS.brake).scene;
  const scene = useMemo(() => {
    const clone = preparedClone(source, opacity);
    branchVisible(clone, "BRAKE_ROTOR_Rotor_0", showDisc);
    branchVisible(clone, "BRAKE_CALIPER", showCaliper);
    return clone;
  }, [opacity, showCaliper, showDisc, source]);
  const scale = radius * 0.46 / GLB_SOURCE_DIMENSIONS.brake.rotorRadius;
  const mirror = mirrored ? -1 : 1;
  const [cx, cy, cz] = GLB_SOURCE_DIMENSIONS.brake.centre;
  return (
    <group position={position} quaternion={quaternion} name="glb-fren-katmani">
      <group rotation={[0, -Math.PI / 2, 0]}>
        <group scale={[scale, scale, scale * mirror]}>
          <primitive object={scene} position={[-cx, -cy, -cz]} />
        </group>
      </group>
    </group>
  );
}
function ImportedHub({
  position,
  quaternion,
  radius,
  width,
  opacity,
}: {
  position: ThreePosition;
  quaternion: ThreeQuaternion;
  radius: number;
  width: number;
  opacity: number;
}) {
  const source = useGLTF(MODEL_URLS.hub).scene;
  const scene = useMemo(() => preparedClone(source, opacity), [opacity, source]);
  const radialScale = radius * 0.24 / GLB_SOURCE_DIMENSIONS.hub.radius;
  const widthScale = width * 0.42 / GLB_SOURCE_DIMENSIONS.hub.width;
  const [cx, cy, cz] = GLB_SOURCE_DIMENSIONS.hub.centre;
  return (
    <group position={position} quaternion={quaternion} name="glb-porya-katmani">
      <group scale={[radialScale, radialScale, widthScale]}>
        <primitive object={scene} position={[-cx, -cy, -cz]} />
      </group>
    </group>
  );
}

const uprightFrame = (
  upper: ThreePosition,
  lower: ThreePosition,
  wheelQuaternion: ThreeQuaternion,
): { quaternion: ThreeQuaternion; span: number } => {
  const vertical = new Vector3(...upper).sub(new Vector3(...lower));
  const span = vertical.length();
  if (span <= 1e-9) return { quaternion: [0, 0, 0, 1], span: 0 };
  vertical.normalize();
  const wheelAxis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...wheelQuaternion));
  const axle = wheelAxis.addScaledVector(vertical, -wheelAxis.dot(vertical));
  if (axle.lengthSq() <= 1e-12) axle.set(0, 0, 1);
  axle.normalize();
  const longitudinal = new Vector3().crossVectors(vertical, axle).normalize();
  axle.crossVectors(longitudinal, vertical).normalize();
  const rotation = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(longitudinal, vertical, axle),
  );
  return { quaternion: [rotation.x, rotation.y, rotation.z, rotation.w], span };
};

function ImportedUpright({
  position,
  upper,
  lower,
  wheelQuaternion,
  mirrored,
  opacity,
}: {
  position: ThreePosition;
  upper: ThreePosition;
  lower: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  mirrored: boolean;
  opacity: number;
}) {
  const source = useGLTF(MODEL_URLS.upright).scene;
  const scene = useMemo(() => preparedClone(source, opacity), [opacity, source]);
  const frame = useMemo(
    () => uprightFrame(upper, lower, wheelQuaternion),
    [lower, upper, wheelQuaternion],
  );
  const scale = frame.span > 0
    ? frame.span * 0.98 / GLB_SOURCE_DIMENSIONS.upright.height
    : 1;
  const mirror = mirrored ? -1 : 1;
  const [cx, cy, cz] = GLB_SOURCE_DIMENSIONS.upright.centre;
  return (
    <group
      position={position}
      quaternion={frame.quaternion}
      name="glb-upright-katmani"
      userData={{ visualStatus: "IMPORTED_NOT_DIMENSIONALLY_VALIDATED" }}
    >
      <group scale={[scale * mirror * 0.68, scale, scale * 0.52]}>
        <primitive object={scene} position={[-cx, -cy, -cz]} />
      </group>
    </group>
  );
}

function ImportedCoilover({ placement, opacity }: { placement: CoiloverPlacement; opacity: number }) {
  const source = useGLTF(MODEL_URLS.coilover).scene;
  const scene = useMemo(() => {
    const clone = preparedClone(source, opacity);
    tuneBranchMaterial(clone, "opruga_low", 0.25, 0.58);
    tuneBranchMaterial(clone, "bump stop_low", 0.02, 0.9);
    return clone;
  }, [opacity, source]);
  const start = new Vector3(...placement.start);
  const end = new Vector3(...placement.end);
  const direction = end.clone().sub(start);
  const targetLength = direction.length();
  if (targetLength <= 1e-9) return null;
  const sourceMountLength = GLB_SOURCE_DIMENSIONS.coilover.mountHighY
    - GLB_SOURCE_DIMENSIONS.coilover.mountLowY;
  const sourceMountCentreY = (
    GLB_SOURCE_DIMENSIONS.coilover.mountLowY + GLB_SOURCE_DIMENSIONS.coilover.mountHighY
  ) / 2;
  const scale = targetLength / sourceMountLength;
  const midpoint = start.add(end).multiplyScalar(0.5);
  const quaternion = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  );
  return (
    <group
      position={midpoint}
      quaternion={quaternion}
      name="glb-coilover-katmani"
      userData={{ visualStatus: "SOLVED_ACTUATION_GEOMETRY", kinematicClosure: true, mechanicallyMounted: false, physicalValidation: false }}
    >
      {/* Keep the imported coilover's radial dimensions fixed while matching the solved eye-to-eye length. */}
      <group scale={[1, scale, 1]}>
        <primitive object={scene} position={[0, -sourceMountCentreY, 0]} />
      </group>
      {[-targetLength / 2, targetLength / 2].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.012, 16, 12]} />
          <meshStandardMaterial color="#606a73" metalness={0.45} roughness={0.52} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

function DemoMountStrut({ start, end, opacity }: { start: ThreePosition; end: ThreePosition; opacity: number }) {
  const a = new Vector3(...start);
  const b = new Vector3(...end);
  const delta = b.clone().sub(a);
  const length = delta.length();
  if (length < 1e-6) return null;
  return (
    <mesh position={a.add(b).multiplyScalar(0.5)} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize())} castShadow>
      <cylinderGeometry args={[0.012, 0.012, length, 12]} />
      <meshStandardMaterial color="#68747c" metalness={0.42} roughness={0.48} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function DemoMountEye({ position, opacity }: { position: ThreePosition; opacity: number }) {
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[0.017, 16, 12]} />
      <meshStandardMaterial color="#39434a" metalness={0.45} roughness={0.5} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function DemoDamperClevis({ position, toward, opacity }: { position: ThreePosition; toward: ThreePosition; opacity: number }) {
  const direction = new Vector3(...toward).sub(new Vector3(...position)).normalize();
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  return (
    <group position={position} quaternion={quaternion} name="demo-damper-clevis">
      {[-0.019, 0.019].map((x) => (
        <mesh key={x} position={[x, 0, 0]} castShadow>
          <boxGeometry args={[0.008, 0.055, 0.033]} />
          <meshStandardMaterial color="#65717a" metalness={0.55} roughness={0.43} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      ))}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.052, 16]} />
        <meshStandardMaterial color="#252d33" metalness={0.62} roughness={0.38} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}

function ImportedSuspensionReference({
  positionFor,
  mirrored,
}: {
  positionFor: (id: string) => ThreePosition;
  mirrored: boolean;
}) {
  const source = useGLTF(MODEL_URLS.suspension).scene;
  const scene = useMemo(() => preparedClone(source, 0.2), [source]);
  const transform = useMemo(() => {
    const ids = [
      "uca_front_inboard", "uca_rear_inboard", "uca_outboard",
      "lca_front_inboard", "lca_rear_inboard", "lca_outboard",
      "tie_rod_inboard", "tie_rod_outboard",
    ];
    const box = new Box3().setFromPoints(ids.map((id) => new Vector3(...positionFor(id))));
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const scale = Math.max(size.x, size.y, size.z) * 0.9
      / GLB_SOURCE_DIMENSIONS.suspension.longestSpan;
    return { centre, scale };
  }, [positionFor]);
  const [cx, cy, cz] = GLB_SOURCE_DIMENSIONS.suspension.centre;
  return (
    <group
      position={transform.centre}
      name="glb-suspansiyon-temsili-referans"
      userData={{ visualStatus: "UNSUPPORTED_STATIC_REFERENCE" }}
    >
      <group scale={[transform.scale * (mirrored ? -1 : 1), transform.scale, transform.scale]}>
        <primitive object={scene} position={[-cx, -cy, -cz]} />
      </group>
    </group>
  );
}

export function GlbCadAssembly({
  positionFor,
  referencePositionFor,
  wheelPosition,
  wheelQuaternion,
  wheelRadius,
  wheelWidth,
  visibility,
  mirrored,
  showRepresentativeSuspension,
  actuation,
  staticWheelCenter,
  actuationPointFor,
  kinematicPose,
  opacity = 1,
}: {
  positionFor: (id: string) => ThreePosition;
  referencePositionFor: (id: string) => ThreePosition;
  wheelPosition: ThreePosition;
  wheelQuaternion: ThreeQuaternion;
  wheelRadius: number;
  wheelWidth: number;
  visibility: VisibilityState;
  mirrored: boolean;
  showRepresentativeSuspension: boolean;
  actuation?: ActuationGeometry;
  staticWheelCenter: Vec3;
  actuationPointFor?: (point: Vec3) => ThreePosition;
  kinematicPose?: KinematicPose;
  opacity?: number;
}) {
  const upper = positionFor("uca_outboard");
  const lower = positionFor("lca_outboard");
  // Reference-style direct-acting damper: lower eye on the moving lower control
  // arm, upper eye on a fixed inboard chassis pickup reference. Demo geometry only.
  // Existing pushrod/rocker actuation remains the separate engineering solver.
  const lowerOutboard = positionFor("lca_outboard");
  const lowerFront = positionFor("lca_front_inboard");
  const lowerRear = positionFor("lca_rear_inboard");
  const upperFront = referencePositionFor("uca_front_inboard");
  const upperRear = referencePositionFor("uca_rear_inboard");
  const lowerInboard: ThreePosition = [
    (lowerFront[0] + lowerRear[0]) / 2,
    (lowerFront[1] + lowerRear[1]) / 2,
    (lowerFront[2] + lowerRear[2]) / 2,
  ];
  const upperInboard: ThreePosition = [
    (upperFront[0] + upperRear[0]) / 2,
    (upperFront[1] + upperRear[1]) / 2,
    (upperFront[2] + upperRear[2]) / 2,
  ];
  // Reference-style outboard mounting: lower eye on the upper face of the
  // moving lower arm, top eye above it on a fixed chassis-side bracket.
  // Both points remain inboard of the tire and are visual demo locations.
  const lowerEye: ThreePosition = [
    lowerOutboard[0] * 0.54 + lowerInboard[0] * 0.46,
    lowerOutboard[1] * 0.54 + lowerInboard[1] * 0.46 + 0.045,
    lowerOutboard[2] * 0.54 + lowerInboard[2] * 0.46,
  ];
  const upperEye: ThreePosition = [
    lowerEye[0] * 0.82 + upperInboard[0] * 0.18,
    Math.max(upperInboard[1] + 0.16, lowerEye[1] + Math.max(wheelRadius * 0.85, 0.3)),
    lowerEye[2] * 0.82 + upperInboard[2] * 0.18,
  ];
  const coiloverPlacement: CoiloverPlacement = { start: lowerEye, end: upperEye };
  return (
    <group name="ithal-glb-montaji" userData={{ source: "GLB", physicalValidation: false }}>
      {visibility.wheel && (visibility.tire || visibility.rim) && (
        <ImportedWheel
          position={wheelPosition}
          quaternion={wheelQuaternion}
          radius={wheelRadius}
          width={wheelWidth}
          mirrored={mirrored}
          showTire={visibility.tire}
          showRim={visibility.rim}
          opacity={opacity}
        />
      )}
      {visibility.wheel && visibility.brake && (visibility.brakeDisc || visibility.caliper) && (
        <ImportedBrake
          position={wheelPosition}
          quaternion={wheelQuaternion}
          radius={wheelRadius}
          mirrored={mirrored}
          showDisc={visibility.brakeDisc}
          showCaliper={visibility.caliper}
          opacity={opacity}
        />
      )}
      {visibility.wheel && visibility.hub && (
        <ImportedHub
          position={wheelPosition}
          quaternion={wheelQuaternion}
          radius={wheelRadius}
          width={wheelWidth}
          opacity={opacity}
        />
      )}
      {visibility.upright && (
        <ImportedUpright
          position={wheelPosition}
          upper={upper}
          lower={lower}
          wheelQuaternion={wheelQuaternion}
          mirrored={mirrored}
          opacity={opacity}
        />
      )}
      {visibility.coilover && (
        <group name="demo-direct-acting-damper-mounts" userData={{ visualStatus: "DEMO_DIRECT_ACTING_NOT_ENGINEERING_VALIDATED" }}>
          {/* Compact lower-arm tab and upper chassis-side mounting stub.
              Do not render fictitious full-length chassis braces. */}
          <DemoMountStrut start={[lowerEye[0], lowerEye[1] - 0.045, lowerEye[2]]} end={lowerEye} opacity={opacity} />
          <DemoMountStrut
            start={upperEye}
            end={[
              upperEye[0] + (upperInboard[0] - upperEye[0]) * 0.09,
              upperEye[1] + (upperInboard[1] - upperEye[1]) * 0.09,
              upperEye[2] + (upperInboard[2] - upperEye[2]) * 0.09,
            ]}
            opacity={opacity}
          />
          <DemoMountEye position={lowerEye} opacity={opacity} />
          <DemoMountEye position={upperEye} opacity={opacity} />
          <DemoDamperClevis position={lowerEye} toward={upperEye} opacity={opacity} />
          <DemoDamperClevis position={upperEye} toward={lowerEye} opacity={opacity} />
        </group>
      )}
      {visibility.coilover && (
        <ImportedCoilover
          placement={coiloverPlacement}
          opacity={opacity}
        />
      )}
      {showRepresentativeSuspension && (
        <>
          <ImportedSuspensionReference
            positionFor={referencePositionFor}
            mirrored={mirrored}
          />
        </>
      )}
    </group>
  );
}

