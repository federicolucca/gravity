import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Calculator,
  Calendar,
  Cloud,
  Code,
  Coins,
  Compass,
  Cpu,
  Database,
  Dumbbell,
  ExternalLink,
  Eye,
  Fish,
  Gamepad2,
  Globe,
  Heart,
  House,
  IdCard,
  Image,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  Mountain,
  Network,
  Newspaper,
  Orbit,
  Package,
  Palette,
  PcCase,
  Pencil,
  Rocket,
  Scale,
  Search,
  Server,
  Shield,
  Sprout,
  SquareTerminal,
  Star,
  TrendingUp,
  Video,
  WavesHorizontal,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The tile icon set: one line icon (24 grid, same stroke) on a pastel tile.
 * Keyed by the name the daemon stores as `icon:<name>`; the daemon validates
 * against the same list (`bus::avatar::ICONS`). Insertion order is the picker
 * order, and an icon's position picks its colour family, so the first ten —
 * the named bots — each get a different one.
 */
export const BOT_TILES: Readonly<Record<string, LucideIcon>> = {
  orbit: Orbit,
  zap: Zap,
  pencil: Pencil,
  beyond: ExternalLink,
  wrench: Wrench,
  pulse: Activity,
  robot: Bot,
  star: Star,
  network: Network,
  sprout: Sprout,
  newspaper: Newspaper,
  scale: Scale,
  calculator: Calculator,
  dumbbell: Dumbbell,
  passport: IdCard,
  mountain: Mountain,
  waves: WavesHorizontal,
  leaf: Leaf,
  trend: TrendingUp,
  video: Video,
  mail: Mail,
  calendar: Calendar,
  comic: MessageCircle,
  book: BookOpen,
  home: House,
  globe: Globe,
  server: Server,
  idea: Lightbulb,
  mic: Mic,
  chip: Cpu,
  eye: Eye,
  code: Code,
  terminal: SquareTerminal,
  shield: Shield,
  database: Database,
  cloud: Cloud,
  rocket: Rocket,
  heart: Heart,
  gamepad: Gamepad2,
  palette: Palette,
  image: Image,
  briefcase: Briefcase,
  fish: Fish,
  compass: Compass,
  pin: MapPin,
  package: Package,
  bell: Bell,
  search: Search,
  coin: Coins,
  minipc: PcCase,
};

/** The ten pastel families, in the order icons cycle through them. */
const FAMILIES = [
  "violet",
  "amber",
  "pink",
  "sky",
  "teal",
  "rose",
  "blue",
  "yellow",
  "indigo",
  "green",
] as const;

const NAMES = Object.keys(BOT_TILES);

export interface BotTile {
  readonly Icon: LucideIcon;
  /** Selects the `.tile-<family>` colours. */
  readonly family: string;
}

/** The tile for a stored avatar value, or undefined if it names none. */
export function tileFor(avatar: string): BotTile | undefined {
  if (!avatar.startsWith("icon:")) {
    return undefined;
  }
  const name = avatar.slice("icon:".length);
  const Icon = BOT_TILES[name];
  if (Icon === undefined) {
    return undefined;
  }
  const family = FAMILIES[NAMES.indexOf(name) % FAMILIES.length] ?? "violet";
  return { Icon, family };
}
