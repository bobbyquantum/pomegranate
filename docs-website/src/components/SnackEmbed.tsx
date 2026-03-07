import React, { useEffect, useMemo, useRef } from 'react';
import { useColorMode } from '@docusaurus/theme-common';

type SnackTheme = 'light' | 'dark';

type SnackEmbedProps = {
  snackId: string;
  platform?: 'ios' | 'android' | 'web' | 'mydevice';
  preview?: boolean;
  height?: number;
};

function snackStyle(theme: SnackTheme, height: number): Partial<CSSStyleDeclaration> {
  return {
    overflow: 'hidden',
    background: theme === 'dark' ? '#0C0D0E' : '#fbfcfd',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    height: `${height}px`,
    width: '100%',
  };
}

export default function SnackEmbed({
  snackId,
  platform = 'web',
  preview = true,
  height = 505,
}: SnackEmbedProps): React.ReactElement {
  const { colorMode } = useColorMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const theme = (colorMode === 'dark' ? 'dark' : 'light') as SnackTheme;

  const embedConfig = useMemo(
    () => ({ snackId, platform, preview, theme, height }),
    [height, platform, preview, snackId, theme],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();

    const embed = document.createElement('div');
    embed.dataset.snackId = embedConfig.snackId;
    embed.dataset.snackPlatform = embedConfig.platform;
    embed.dataset.snackPreview = embedConfig.preview ? 'true' : 'false';
    embed.dataset.snackTheme = embedConfig.theme;

    Object.assign(embed.style, snackStyle(embedConfig.theme, embedConfig.height));

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://snack.expo.dev/embed.js';

    container.append(embed, script);

    return () => {
      container.replaceChildren();
    };
  }, [embedConfig]);

  return <div ref={containerRef} />;
}