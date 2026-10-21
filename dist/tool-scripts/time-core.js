export function moments(T, date, time, zone) {
  const plain = T.PlainDateTime.from(date + "T" + time),
    a = plain.toZonedDateTime(zone, { disambiguation: "earlier" }),
    b = plain.toZonedDateTime(zone, { disambiguation: "later" });
  const choices = [a, b].filter((z) => z.toPlainDateTime().equals(plain));
  if (!choices.length)
    throw Error(
      "This local time does not exist because of a daylight-saving change. Choose another time.",
    );
  return [
    ...new Map(
      choices.map((z) => [
        z.epochMilliseconds,
        { epoch: Number(z.epochMilliseconds), offset: z.offset },
      ]),
    ).values(),
  ];
}
export function dateDays(T, a, b, inclusive = false) {
  const days = T.PlainDate.from(a).until(T.PlainDate.from(b), {
    largestUnit: "day",
  }).days;
  return inclusive ? days + (days < 0 ? -1 : 1) : days;
}
