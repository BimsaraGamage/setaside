import { useState } from "react";
import type { Place } from "./data";
import { lastPlace, type PlaceWay, placesFor, rememberPlace } from "./last-place";

/** The place a sheet's entry moves (spec 6): what is picked, what can be, and how to remember it. */
export interface PlacePick {
  /** The place the entry names; null moves no place. */
  placeId: string | null;
  /** The places offered: in use, in the entry's currency. None: no choice is shown. */
  choices: Place[];
  pick: (placeId: string | null) => void;
  /** Call on save: the next entry this way, in this currency, starts on this place. */
  remember: () => void;
}

/**
 * The place choice of a sheet (ticket SAB-52, spec 6, 10): it starts on the place used last for money
 * going this way in this currency, so it costs no extra tap. A pick is kept while it fits the currency.
 * `off`: this entry moves no place (money that stays where it is).
 */
export function usePlaceChoice(places: Place[], currency: string, way: PlaceWay, off = false): PlacePick {
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const choices = off ? [] : placesFor(places, currency);
  const fits = picked === null || choices.some((p) => p.id === picked);
  const placeId =
    choices.length === 0 ? null : fits && picked !== undefined ? picked : lastPlace(places, currency, way);
  return {
    placeId,
    choices,
    pick: setPicked,
    remember: () => {
      if (choices.length > 0) rememberPlace(places, currency, placeId, way);
    },
  };
}

/** The choice itself: nothing while the user has no place in that currency. */
export function PlaceChoice({ label, choice }: { label: string; choice: PlacePick }) {
  if (choice.choices.length === 0) return null;
  return (
    <label className="field">
      {label}
      <select value={choice.placeId ?? ""} onChange={(e) => choice.pick(e.target.value || null)}>
        {choice.choices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="">No place</option>
      </select>
    </label>
  );
}
