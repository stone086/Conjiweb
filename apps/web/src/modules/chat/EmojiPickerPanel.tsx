import EmojiPicker, { Theme } from "emoji-picker-react";

export default function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <EmojiPicker
      theme={Theme.DARK}
      lazyLoadEmojis
      onEmojiClick={(emojiData) => onPick(emojiData.emoji)}
    />
  );
}
