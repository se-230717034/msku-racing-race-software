import type {
  ActuationGeometry,
  KinematicState,
  VehicleParameterManifest,
  Vec3,
} from "@msku/contracts";

import { solveActuationKinematics } from "./actuationKinematics";

export interface CoiloverSeriesRequestPayload {
  wheelTravelM: number[];
  wheelVelocityMps: number[];
  coiloverLengthM: number[];
  referenceCoiloverLengthM: number;
  springRateNPerM: number;
  preloadN: number;
  compressionCoefficientNsPerM: number;
  reboundCoefficientNsPerM: number;
  minimumCoiloverLengthM?: number;
  maximumCoiloverLengthM?: number;
  compressionOnly: true;
  parameterManifest?: VehicleParameterManifest;
}

export type CoiloverSeriesInputResult =
  | { status: "READY"; payload: CoiloverSeriesRequestPayload }
  | { status: "NOT_COMPUTABLE"; reason: string };

/**
 * Builds physics-engine input only from accepted kinematic poses and explicit
 * velocity/damper parameters. Browser frame timing is deliberately ignored.
 */
export const buildCoiloverSeriesInput = (
  actuation: ActuationGeometry | undefined,
  staticWheelCenter: Vec3 | undefined,
  states: KinematicState[],
  wheelVelocityMps: number,
  parameterManifest?: VehicleParameterManifest,
): CoiloverSeriesInputResult => {
  if (!actuation || !staticWheelCenter) {
    return { status: "NOT_COMPUTABLE", reason: "Aktüasyon geometrisi tanımlı değil." };
  }
  if (!actuation.damper) {
    return { status: "NOT_COMPUTABLE", reason: "Sıkışma/geri açılma sönüm katsayıları tanımlı değil." };
  }
  if (states.length < 3 || !Number.isFinite(wheelVelocityMps)) {
    return { status: "NOT_COMPUTABLE", reason: "En az üç geçerli durum ve sonlu tekerlek hızı gerekli." };
  }
  const staticResult = solveActuationKinematics(actuation, staticWheelCenter);
  if (staticResult.status === "FAILED") {
    return { status: "NOT_COMPUTABLE", reason: `Statik aktüasyon çözülemedi: ${staticResult.reason}` };
  }
  const lengths: number[] = [];
  for (const state of states) {
    if (state.calculationStatus !== "VERIFIED_NUMERICALLY" || !state.pose) {
      return { status: "NOT_COMPUTABLE", reason: "Başarısız kinematik durum coilover kuvvet serisini engelledi." };
    }
    const result = solveActuationKinematics(actuation, staticWheelCenter, state.pose);
    if (result.status === "FAILED") {
      return { status: "NOT_COMPUTABLE", reason: `Aktüasyon kapanışı çözülemedi: ${result.reason}` };
    }
    lengths.push(result.coiloverLengthM);
  }
  return {
    status: "READY",
    payload: {
      wheelTravelM: states.map((state) => state.travelM),
      wheelVelocityMps: states.map(() => wheelVelocityMps),
      coiloverLengthM: lengths,
      referenceCoiloverLengthM: staticResult.coiloverLengthM,
      springRateNPerM: actuation.springRateNPerM,
      preloadN: actuation.springPreloadN,
      compressionCoefficientNsPerM: actuation.damper.compressionCoefficientNsPerM,
      reboundCoefficientNsPerM: actuation.damper.reboundCoefficientNsPerM,
      minimumCoiloverLengthM: actuation.minimumLengthM,
      maximumCoiloverLengthM: actuation.maximumLengthM,
      compressionOnly: true,
      parameterManifest,
    },
  };
};
