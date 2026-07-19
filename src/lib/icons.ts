/**
 * App icon set — a single import surface for every symbol in the UI.
 *
 * The whole app used to import line icons straight from `lucide-react`. Those
 * read as generic/synthetic, so the icon set was moved to **Phosphor Icons**
 * (@phosphor-icons/react) — a richer, hand-drawn family with real weights
 * (the app renders them "duotone" by default, see IconProvider). To keep the
 * migration a one-line change per file, this module re-exports each Phosphor
 * icon under the SAME name the components already use, so every call-site
 * (`<Search className="h-4 w-4" />`, icon maps, the `LucideIcon` type) keeps
 * working untouched — only the import source changes from the old icon package
 * to "@/lib/icons".
 *
 * Phosphor components accept the same props these call-sites pass: `className`
 * (Tailwind `h-* w-*` sizing wins over the intrinsic size), `size`, and colour
 * via `currentColor` (`text-*`). A stray `strokeWidth` from a legacy call-site
 * is forwarded to the <svg> and harmlessly ignored (Phosphor icons are fills).
 *
 * To change every icon's heaviness, edit the single `weight` in IconProvider.
 */

// The shared icon component type (was `LucideIcon`; now Phosphor's `Icon`).
export type { Icon as LucideIcon } from "@phosphor-icons/react";

export {
  Pulse as Activity,
  WarningCircle as AlertCircle,
  Warning as AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowsDownUp as ArrowUpDown,
  SealCheck as BadgeCheck,
  ChartBar as BarChart3,
  Bell,
  BookOpen,
  Cube as Boxes,
  Briefcase,
  Buildings as Building2,
  CalendarDots as CalendarClock,
  CalendarBlank as CalendarDays,
  CalendarHeart,
  Camera,
  Check,
  Checks as CheckCheck,
  CheckCircle as CheckCircle2,
  CaretDown as ChevronDown,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  ClipboardText as ClipboardCheck,
  ClipboardText as ClipboardList,
  Clipboard as ClipboardPaste,
  Clock,
  Cloud,
  Coins,
  Compass,
  Copy,
  Crosshair,
  Database,
  DownloadSimple as Download,
  Factory,
  Signature as FileSignature,
  FileXls as FileSpreadsheet,
  FileText,
  Flag,
  Folder,
  Kanban as FolderKanban,
  FolderMinus,
  FolderOpen,
  Folders as FolderSync,
  Gauge,
  GitBranch,
  GitDiff as GitCompare,
  Globe,
  DotsSixVertical as GripVertical,
  Hammer,
  HardHat,
  Question as HelpCircle,
  Tray as Inbox,
  Info,
  Key as KeyRound,
  Stack as Layers,
  SquaresFour as LayoutDashboard,
  GridFour as LayoutGrid,
  Books as Library,
  Lifebuoy as LifeBuoy,
  ListChecks,
  CircleNotch as Loader2,
  Lock,
  SignOut as LogOut,
  Envelope as Mail,
  MapPin,
  Megaphone,
  List as Menu,
  ChatText as MessageSquare,
  ChatText as MessageSquareText,
  NotePencil as NotebookPen,
  Package,
  Paperclip,
  PauseCircle,
  PencilSimple as Pencil,
  Phone,
  Play,
  Plus,
  Printer,
  ArrowsClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  FloppyDisk as Save,
  Scan as ScanSearch,
  MagnifyingGlass as Search,
  PaperPlaneTilt as Send,
  GearSix as Settings2,
  ShieldCheck,
  Sparkle as Sparkles,
  Note as StickyNote,
  Tag,
  TagSimple as Tags,
  Trash as Trash2,
  TrendUp as TrendingUp,
  Trophy,
  Truck,
  LockOpen as Unlock,
  Plugs as Unplug,
  UploadSimple as Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
  XCircle,
} from "@phosphor-icons/react";
