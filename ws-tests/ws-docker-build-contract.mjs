const WS_DOCKERFILE_PATH = "ws-server/Dockerfile";
const WS_DOCKER_BUILD_CONTEXT = ".";

function wsDockerBuildArgs(imageTag) {
  return ["build", "-t", imageTag, "-f", WS_DOCKERFILE_PATH, WS_DOCKER_BUILD_CONTEXT];
}

export { WS_DOCKERFILE_PATH, WS_DOCKER_BUILD_CONTEXT, wsDockerBuildArgs };
