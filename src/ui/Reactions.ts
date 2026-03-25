// Reaction bar component

export interface ReactionGroup {
  /** Emoji key — either a Unicode character or a :shortcode: */
  key: string;
  count: number;
  /** Whether the local user has reacted with this */
  own: boolean;
  /** Resolved mxc:// URL if this is a custom emoji reaction, otherwise undefined */
  imageUrl?: string;
}

/**
 * Creates a reaction bar element populated with the given reaction groups.
 * Returns the container element so it can be appended to a message row.
 */
export function createReactionBar(reactions: ReactionGroup[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "reaction-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Reactions");

  for (const reaction of reactions) {
    bar.appendChild(createReactionChip(reaction));
  }

  return bar;
}

function createReactionChip(reaction: ReactionGroup): HTMLElement {
  const chip = document.createElement("button");
  chip.className = "reaction" + (reaction.own ? " reaction--own" : "");
  chip.setAttribute("type", "button");
  chip.setAttribute("tabindex", "0");
  chip.setAttribute("aria-pressed", String(reaction.own));
  chip.setAttribute(
    "aria-label",
    `${reaction.key} reaction, ${reaction.count} ${reaction.count === 1 ? "person" : "people"}${reaction.own ? ", reacted by you" : ""}`
  );

  // Clicking a chip toggles that reaction — dispatch a bubbling event so the
  // nearest [data-message-id] ancestor can be found by the global listener.
  chip.addEventListener("click", () => {
    chip.dispatchEvent(
      new CustomEvent("quark:chip-react", {
        bubbles: true,
        detail: { key: reaction.key },
      })
    );
  });

  // Emoji glyph or image
  if (reaction.imageUrl) {
    const img = document.createElement("img");
    img.className = "reaction__emoji";
    img.src = reaction.imageUrl;
    img.alt = reaction.key;
    img.title = reaction.key;
    chip.appendChild(img);
  } else {
    const emojiSpan = document.createElement("span");
    emojiSpan.className = "reaction__emoji";
    emojiSpan.textContent = reaction.key;
    chip.appendChild(emojiSpan);
  }

  // Count
  const countSpan = document.createElement("span");
  countSpan.className = "reaction__count";
  countSpan.textContent = String(reaction.count);
  chip.appendChild(countSpan);

  return chip;
}

/**
 * Updates an existing reaction bar in-place with a new set of reactions.
 * Replaces all children rather than diffing.
 */
export function updateReactionBar(bar: HTMLElement, reactions: ReactionGroup[]): void {
  bar.innerHTML = "";
  for (const reaction of reactions) {
    bar.appendChild(createReactionChip(reaction));
  }
}
