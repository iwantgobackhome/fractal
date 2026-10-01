import { useEffect, useRef, useState, type JSX } from 'react';
import type { FeedImage, HubApi } from './hub-api';
import { feedImagePath } from './feed-images';

/** A bounded, lazy Hub preview. Failures remove the media without disturbing actions. */
export function FeedPicture({ hub, image, kind = 'figure', onOpen, label, detail = false }: {
  hub: HubApi; image?: FeedImage | null; kind?: 'figure' | 'photo';
  onOpen?(): void; label?: string; detail?: boolean;
}): JSX.Element | null {
  const path = feedImagePath(image?.url);
  const root = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ hub: HubApi; path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true, started = false, url: string | undefined, release: (() => void) | undefined;
    const start = () => {
      if (started || !alive) return;
      started = true;
      try {
        const lease = hub.feedImages.acquire(path);
        release = lease.release;
        void lease.blob.then(async (blob) => {
          if (!alive) return;
          url = URL.createObjectURL(blob);
          const decoded = new Image();
          decoded.src = url;
          await decoded.decode();
          if (alive && decoded.naturalWidth * decoded.naturalHeight <= 20_000_000) setLoaded({ hub, path, url });
        }).catch(() => { /* Text remains usable. */ });
      } catch { /* Cache admission is bounded. */ }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { start(); observer?.disconnect(); }
    }, { rootMargin: '160px' });
    if (observer && root.current) observer.observe(root.current); else start();
    return () => { alive = false; observer?.disconnect(); release?.(); if (url) URL.revokeObjectURL(url); };
  }, [hub, path]);
  if (!path) return null;
  const src = loaded?.hub === hub && loaded.path === path ? loaded.url : null;
  const picture = src ? <span className={`picture picture--${kind}${detail ? ' picture--detail' : ''}`}>
    <img src={src} alt={image?.alt ?? ''} decoding="async" onError={() => setLoaded(null)} />
  </span> : null;
  return <span ref={root} className="feed-picture" data-loaded={!!src}>
    {picture && onOpen ? <button type="button" className="feed-picture__open" onClick={onOpen} aria-label={label}>{picture}</button> : picture}
  </span>;
}
