import type { CornerId } from "@msku/contracts";

const STATUS_LABELS: Record<string, string> = {
  VERIFIED_NUMERICALLY: "Sayısal olarak doğrulandı",
  REFERENCE_BENCHMARKED: "Referansla karşılaştırıldı",
  PARTIALLY_VERIFIED: "Kısmen doğrulandı",
  PARTIALLY_BENCHMARKED: "Kısmen karşılaştırıldı",
  UNVERIFIED: "Doğrulanmadı",
  NOT_BENCHMARKED: "Referansla karşılaştırılmadı",
  UNVALIDATED_PHYSICALLY: "Fiziksel olarak doğrulanmadı",
  NOT_APPROVED: "Onaylanmadı",
  FAILED: "Başarısız",
  converged: "Yakınsadı",
  pending_review: "İnceleme bekliyor",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  demonstration: "Gösterim verisi",
  team_private: "Takıma özel",
  unvalidated: "Doğrulanmamış",
  benchmarked: "Referansla karşılaştırılmış",
  experimentally_validated: "Deneysel olarak doğrulanmış",
  independent: "Bağımsız",
  mirrored_assumption: "Ayna varsayımı",
  synthetic_demo: "Sentetik gösterim",
};

const CORNER_LABELS: Record<CornerId, string> = {
  front_left: "Ön sol",
  front_right: "Ön sağ",
  rear_left: "Arka sol",
  rear_right: "Arka sağ",
};

export const uiStatus = (value: string): string =>
  STATUS_LABELS[value] ?? value.replaceAll("_", " ");

export const uiCorner = (value: CornerId): string => CORNER_LABELS[value];

export const uiBoolean = (value: boolean | null | undefined): string =>
  value == null ? "Bilinmiyor" : value ? "Evet" : "Hayır";

