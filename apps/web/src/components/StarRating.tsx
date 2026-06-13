"use client";

export function StarRating({
  value,
  onRate,
  readonly = false,
}: {
  value: number | null;
  onRate?: (stars: number) => void;
  readonly?: boolean;
}) {
  const rounded = Math.round(value ?? 0);
  return (
    <span className={`stars${readonly ? " readonly" : ""}`} data-testid="star-rating">
      {[1, 2, 3, 4, 5].map((star) =>
        readonly ? (
          <span key={star} className={`star${star <= rounded ? " filled" : ""}`}>
            ★
          </span>
        ) : (
          <button
            key={star}
            type="button"
            className={`star${star <= rounded ? " filled" : ""}`}
            data-testid={`star-${star}`}
            aria-label={`rate ${star} stars`}
            onClick={() => onRate?.(star)}
          >
            ★
          </button>
        ),
      )}
    </span>
  );
}
