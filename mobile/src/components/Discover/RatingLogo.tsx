import React from "react";
import { Image } from "expo-image";

type RatingLogoProps = {
  type: "imdb" | "metascore" | "rotten-tomatoes";
  size?: number;
};

export default function RatingLogo({ type, size = 22 }: RatingLogoProps) {
  const source =
    type === "imdb"
      ? require("@/assets/images/ratingicons/imdb.png")
      : type === "metascore"
        ? require("@/assets/images/ratingicons/metascore.png")
        : require("@/assets/images/ratingicons/rottentomatoes.png");
  const aspectRatio = type === "imdb" ? 1.6 : type === "metascore" ? 1 : 1.37;

  return (
    <Image
      source={source}
      accessibilityLabel={type === "imdb" ? "IMDb" : type === "metascore" ? "Metascore" : "Rotten Tomatoes"}
      contentFit="contain"
      style={{ width: size * aspectRatio, height: size }}
    />
  );
}
