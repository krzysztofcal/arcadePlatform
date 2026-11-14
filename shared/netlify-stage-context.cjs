// Public policy only. Adding another parent requires reviewed code and separate Netlify enrollment GO.
const STAGE_WS_URL = 'wss://ws-preview.kcswh.pl/ws';
const STAGE_PROJECT_REF = 'krydukthwdvccggbyjfw';
const STAGE_PARENT_BRANCH = 'feat/1114-profiles-phase-a';
const STAGE_PARENT_ORIGIN = 'https://feat-1114-profiles-phase-a--playkcswh.netlify.app';
function isStageNetlifyContext(context, origin, identity) {
  if (context === 'deploy-preview' && identity === 'netlify-functions') {
    return typeof origin === 'string' && /^https:\/\/deploy-preview-[1-9][0-9]*--playkcswh\.netlify\.app$/.test(origin);
  }
  return context === 'branch-deploy' && identity === 'netlify-stage-parent' && origin === STAGE_PARENT_ORIGIN;
}
module.exports = { STAGE_WS_URL, STAGE_PROJECT_REF, STAGE_PARENT_BRANCH, STAGE_PARENT_ORIGIN, isStageNetlifyContext };
