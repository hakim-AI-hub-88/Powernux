import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCamera,
  faClipboard,
  faEyeDropper,
  faMicrophone,
  faKeyboard,
  faNoteSticky,
  faRobot,
  faFaceSmile,
  faFolderTree,
  faCode,
  faTerminal,
  faFolderOpen,
  faRotateLeft,
  faBroom,
  faBullseye,
  faStop,
  faPlay,
  faTableCellsLarge,
  faWindowRestore,
  faPuzzlePiece,
  faRocket,
  faThumbtack,
  faThumbtackSlash,
  faTrashCan,
  faUpRightFromSquare,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icons";

// Les outils désignent leur icône par un nom Font Awesome (manifest / registre).
const ICONS: Record<string, IconDefinition> = {
  clipboard: faClipboard,
  camera: faCamera,
  "wand-magic-sparkles": faWandMagicSparkles,
  rocket: faRocket,
  "eye-dropper": faEyeDropper,
  thumbtack: faThumbtack,
  microphone: faMicrophone,
  keyboard: faKeyboard,
  "note-sticky": faNoteSticky,
  robot: faRobot,
  "face-smile": faFaceSmile,
  "folder-tree": faFolderTree,
  code: faCode,
  terminal: faTerminal,
  "folder-open": faFolderOpen,
  "rotate-left": faRotateLeft,
  broom: faBroom,
  bullseye: faBullseye,
  stop: faStop,
  "window-restore": faWindowRestore,
  "table-cells-large": faTableCellsLarge,
  play: faPlay,
  "thumbtack-slash": faThumbtackSlash,
  "trash-can": faTrashCan,
  "up-right-from-square": faUpRightFromSquare,
};

export function iconByName(name: string): IconDefinition {
  return ICONS[name] ?? faPuzzlePiece;
}

export default function ToolIcon({ name, className }: { name: string; className?: string }) {
  return <Icon icon={iconByName(name)} className={className} />;
}
