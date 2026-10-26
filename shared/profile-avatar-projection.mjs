export const PUBLIC_AVATAR_VARIANTS = Object.freeze([
  "comet-blue",
  "falcon-orange",
  "fox-blue",
  "nova-purple",
  "orbit-green",
  "panda-pink",
  "raven-violet", "tiger-gold", "wave-cyan", "wizard-indigo", "bolt-yellow",
  "rocket-red", "ace-silver", "ember-coral", "pixel-teal", "zen-lime"
]);

const PUBLIC_AVATAR_VARIANT_SET = new Set(PUBLIC_AVATAR_VARIANTS);

export function normalizePublicAvatarVariant(value) {
  const variant = typeof value === "string" ? value.trim() : "";
  return PUBLIC_AVATAR_VARIANT_SET.has(variant) ? variant : "default";
}

export function projectPublicAvatar({ avatarKey = null, avatarVariant = null, storageBaseUrl = "" } = {}) {
  // Phase A publishes catalog artwork only. Storage objects remain tracked for cleanup.
  return { type: "default", variant: normalizePublicAvatarVariant(avatarVariant) };
}
