import { environmentPalettes } from "../dist/shared/cse.js";
import { gameFiles } from "../dist/shared/node/project.js";

export function cseEnvironment(config, environment) {
	return environmentPalettes(gameFiles(config, "cse"), environment);
}
