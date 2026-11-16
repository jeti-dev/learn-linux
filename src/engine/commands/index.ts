import { adminCommands } from './admin';
import { awkCommands } from './awk';
import { builtinCommands } from './builtins';
import { fileCommands } from './files';
import { jqCommands } from './jq';
import { networkCommands } from './network';
import { searchCommands } from './search';
import { systemCommands } from './system';
import { textCommands } from './text';
import type { CommandFn } from './types';

/** Every command the simulator understands, by name. */
export const COMMANDS: Record<string, CommandFn> = {
  ...fileCommands,
  ...searchCommands,
  ...textCommands,
  ...awkCommands,
  ...jqCommands,
  ...adminCommands,
  ...networkCommands,
  ...systemCommands,
  ...builtinCommands,
};
