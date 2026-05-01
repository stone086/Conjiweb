import { useEffect, useState } from "react";
import EmojiPicker, { Theme } from "emoji-picker-react";

function getCurrentTheme(): Theme {
  if (typeof document === "undefined") return Theme.DARK;
  return document.documentElement.classList.contains("light") ? Theme.LIGHT : Theme.DARK;
}

export default function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const [theme, setTheme] = useState<Theme>(() => getCurrentTheme());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <EmojiPicker
      theme={theme}
      lazyLoadEmojis
      onEmojiClick={(emojiData) => onPick(emojiData.emoji)}
    />
  );
}
