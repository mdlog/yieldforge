// The YieldForge "YF" mark, cropped from YieldForge_logo.png (see public/ for the favicon sizes).
import mark from '@/assets/brand/yieldforge-mark.webp'

export function BrandMark({ size = 30 }: { size?: number }) {
  return <img className="brand-logo" src={mark} alt="" width={size} height={size} decoding="async" />
}
