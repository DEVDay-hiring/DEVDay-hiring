import type { ImgHTMLAttributes } from 'react'
import { responsiveImages } from './assets'

const prefetched = new Set<string>()
export function preloadImage(src: string, sizes = '100vw') {
  if (prefetched.has(src)) return
  prefetched.add(src)
  const image = new Image()
  image.decoding = 'async'
  image.fetchPriority = 'low'
  const responsive = responsiveImages[src]
  if (responsive) {
    image.sizes = sizes
    image.srcset = responsive.srcSet
  }
  image.src = src
  image.decode().catch(() => { prefetched.delete(src) })
}

/** Choose a smaller image for the rendered size while keeping transparent artwork. */
export default function AssetImage({ src, sizes = '100vw', decoding = 'async', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const image = src ? responsiveImages[src] : undefined
  return <img src={src} srcSet={image?.srcSet} sizes={image ? sizes : undefined}
    width={image?.width} height={image?.height} decoding={decoding} {...props} />
}
