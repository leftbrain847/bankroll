/**
 * Moonhold as an app_builder module. The game is pass-and-play on one device with optional bots, so it runs
 * entirely in the browser: there is no room, no server replay and no ranked score. The rules engine lives in
 * src/game/ (pure, seeded, no clock); the UI in src/client/.
 */
import type { GameModule } from '@app-builder/host';
import config from '../app.config.json';
import { DEFAULT_RULES, type RulesConfig } from './game/rules';

export * from './game/rules';

export const app: GameModule<RulesConfig, null, never, null> = {
  id: config.id,
  defaultConfig: DEFAULT_RULES,
  // Local play only: these room limits are required by the contract but unused.
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: 1, maxPlayers: 1, maxMsgBytes: 256, maxInputsPerSec: 5 },
  parseInput: () => null,
  init: () => null,
  onInput: () => undefined,
  viewFor: () => null,
  isOver: () => true,
};
