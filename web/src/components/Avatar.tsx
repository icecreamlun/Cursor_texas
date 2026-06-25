import type { Emotion } from "../../../server/types";
import catSheet from "../assets/characters/cat-sheet.png";
import foxSheet from "../assets/characters/fox-sheet.png";
import humanSheet from "../assets/characters/human-sheet.png";
import penguinSheet from "../assets/characters/penguin-sheet.png";
import robotSheet from "../assets/characters/robot-sheet.png";

type Character = "fox" | "cat" | "penguin" | "robot" | "human";

const SHEETS: Record<Character, string> = {
  fox: foxSheet,
  cat: catSheet,
  penguin: penguinSheet,
  robot: robotSheet,
  human: humanSheet,
};

const POSE_BY_EMOTION: Record<Emotion, number> = {
  neutral: 0,
  happy: 1,
  thinking: 2,
  confident: 3,
  pokerface: 3,
  shocked: 4,
  nervous: 5,
  tilted: 5,
};

export function Avatar({
  persona,
  emotion,
  size = 180,
}: {
  persona: string;
  emotion: Emotion;
  color: string;
  size?: number;
}) {
  const character = characterForPersona(persona);
  const pose = POSE_BY_EMOTION[emotion] ?? 0;
  const col = pose % 3;
  const row = Math.floor(pose / 3);

  return (
    <div
      className={`avatar character-sprite avatar-${character} emo-${emotion}`}
      role="img"
      aria-label={`${character} ${emotion} character`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${SHEETS[character]})`,
        backgroundPosition: `${col * 50}% ${row * 100}%`,
      }}
    />
  );
}

function characterForPersona(persona: string): Character {
  switch (persona) {
    case "professor":
      return "fox";
    case "maniac":
      return "cat";
    case "rock":
      return "penguin";
    case "luna":
      return "robot";
    default:
      return "human";
  }
}
