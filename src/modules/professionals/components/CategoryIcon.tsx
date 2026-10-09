import {
  Activity,
  Brain,
  Briefcase,
  Cloud,
  Compass,
  Fingerprint,
  GraduationCap,
  Heart,
  House,
  Leaf,
  MessageCircle,
  Moon,
  Shield,
  Sparkles,
  Star,
  Sun,
  Target,
  TriangleAlert,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { MotifCategoryIcon } from '../lib/constants'

/**
 * The 20 icons of `motif_categories_icon_check`. The stored names are Lucide's older ones;
 * `AlertTriangle` and `Home` are now `TriangleAlert` and `House` (same drawings).
 */
const ICONS: Readonly<Record<MotifCategoryIcon, LucideIcon>> = {
  Brain,
  Users,
  AlertTriangle: TriangleAlert,
  Briefcase,
  GraduationCap,
  Fingerprint,
  Shield,
  Leaf,
  Heart,
  Activity,
  Star,
  Zap,
  Cloud,
  Sun,
  Moon,
  Home: House,
  Target,
  Compass,
  Sparkles,
  MessageCircle,
}

/** A motif category's icon, decorative: the caller names it (`motifIconLabel`) where it means something. */
export function CategoryIcon({ icon, className }: { icon: MotifCategoryIcon; className?: string }) {
  const Icon = ICONS[icon]
  return <Icon aria-hidden className={className} />
}
