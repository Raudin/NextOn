import React, { useMemo, useRef } from "react";
import { ScrollView } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { type WatchedItem } from "@/lib/media-api";
import { Group, SectionHeader } from "@/components/Profile/grouped-list";

interface WatchActivityGraphProps {
  items: WatchedItem[];
}

const CELL = 11;
const CELL_GAP = 3;
const CELL_STEP = CELL + CELL_GAP;
/** A full GitHub-style grid: 53 columns of 7 days ≈ one year. */
const WEEK_COUNT = 53;
const WEEKDAY_LABEL_WIDTH = 28;
const MONTH_ROW_HEIGHT = 14;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Sunday-first rows, labelled the way GitHub labels them. */
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/**
 * Intensity ramp. Level 0 is the empty cell, 1-4 climb the theme's purple scale
 * so the graph stays legible in both light and dark mode.
 */
const LEVEL_BACKGROUNDS = ["$purple3", "$purple5", "$purple7", "$purple9"] as const;
const LEVEL_COUNT = LEVEL_BACKGROUNDS.length;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

interface ActivityDay {
  key: string;
  date: Date;
  count: number;
  level: number;
  /** Days after today in the trailing week render as empty slots. */
  isFuture: boolean;
}

interface ActivityWeek {
  days: ActivityDay[];
}

interface ActivityGrid {
  weeks: ActivityWeek[];
  monthLabels: { index: number; label: string }[];
  total: number;
  busiestDay: number;
}

function buildGrid(items: WatchedItem[]): ActivityGrid {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (!item.watched_at) continue;
    const watchedAt = new Date(item.watched_at);
    if (Number.isNaN(watchedAt.getTime())) continue;

    const key = toDateKey(watchedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = startOfDay(new Date());
  // Start on the Sunday that opens the week 52 weeks back, so today lands in the
  // final column and the grid always ends on the current week.
  const gridStart = new Date(today);
  gridStart.setDate(gridStart.getDate() - (WEEK_COUNT - 1) * 7 - today.getDay());

  let total = 0;
  let busiestDay = 0;
  const rawWeeks: ActivityDay[][] = [];

  for (let week = 0; week < WEEK_COUNT; week++) {
    const days: ActivityDay[] = [];

    for (let day = 0; day < 7; day++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + week * 7 + day);

      const key = toDateKey(date);
      const isFuture = date.getTime() > today.getTime();
      const count = isFuture ? 0 : counts.get(key) ?? 0;

      total += count;
      busiestDay = Math.max(busiestDay, count);
      days.push({ key, date, count, level: 0, isFuture });
    }

    rawWeeks.push(days);
  }

  // Scale each day into one of the four intensity levels, relative to the
  // busiest day so a light user still gets a readable graph.
  const weeks = rawWeeks.map((days) => ({
    days: days.map((day) => ({
      ...day,
      level:
        day.count === 0 || busiestDay === 0
          ? 0
          : Math.min(LEVEL_COUNT, Math.max(1, Math.ceil((day.count / busiestDay) * LEVEL_COUNT))),
    })),
  }));

  // One label per month, anchored to the first column whose week starts in that
  // month (i.e. a Sunday falling on the 1st-7th), so no interior month can be
  // skipped the way a plain "month changed" rule can. Partial months at either
  // edge are only labelled when they have room. Dates are used directly so no
  // timezone re-interpretation can shift a label into the wrong column.
  const monthLabels: { index: number; label: string }[] = [];
  rawWeeks.forEach((days, index) => {
    const firstDay = days[0]?.date;
    if (firstDay && firstDay.getDate() <= 7) {
      monthLabels.push({ index, label: MONTHS[firstDay.getMonth()] });
    }
  });

  const firstPlaced = monthLabels[0];
  const leadingDay = rawWeeks[0]?.[0]?.date;
  if (leadingDay && (!firstPlaced || firstPlaced.index >= 3)) {
    monthLabels.unshift({ index: 0, label: MONTHS[leadingDay.getMonth()] });
  }

  const lastPlaced = monthLabels[monthLabels.length - 1];
  const trailingDay = rawWeeks[rawWeeks.length - 1]?.[0]?.date;
  if (
    lastPlaced &&
    trailingDay &&
    MONTHS[trailingDay.getMonth()] !== lastPlaced.label &&
    rawWeeks.length - 1 - lastPlaced.index >= 3
  ) {
    monthLabels.push({
      index: rawWeeks.length - 1,
      label: MONTHS[trailingDay.getMonth()],
    });
  }

  return { weeks, monthLabels, total, busiestDay };
}

export default function WatchActivityGraph({ items }: WatchActivityGraphProps) {
  const scrollRef = useRef<ScrollView>(null);
  const hasAutoScrolled = useRef(false);

  const { weeks, monthLabels, total, busiestDay } = useMemo(() => buildGrid(items), [items]);

  return (
    <YStack gap={10} w="100%">
      <SectionHeader>Watch activity</SectionHeader>

      <Group>
        <YStack p={12} gap={10}>
          <XStack ai="center" jc="space-between" gap={10}>
            <Text f={1} color="$color" fos="$3" numberOfLines={1}>
              {total === 0
                ? "No activity in the last year"
                : `${total} watched in the last year`}
            </Text>
            {busiestDay > 0 ? (
              <Text color="$color" opacity={0.5} fos="$2" numberOfLines={1}>
                Best day {busiestDay}
              </Text>
            ) : null}
          </XStack>

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={`Watch activity over the last year: ${total} watched`}
            onContentSizeChange={() => {
              // Land on the most recent weeks; only ever adjust once so manual
              // scrolling is not fought by later re-layouts.
              if (hasAutoScrolled.current) return;
              hasAutoScrolled.current = true;
              scrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            <YStack gap={CELL_GAP}>
              <XStack gap={CELL_GAP}>
                <YStack w={WEEKDAY_LABEL_WIDTH} h={MONTH_ROW_HEIGHT} />
                <YStack width={weeks.length * CELL_STEP} h={MONTH_ROW_HEIGHT} position="relative">
                  {monthLabels.map((month) => (
                    <Text
                      key={month.index}
                      pos="absolute"
                      l={month.index * CELL_STEP}
                      t={0}
                      fos={10}
                      lh={MONTH_ROW_HEIGHT}
                      color="$color"
                      opacity={0.5}
                      numberOfLines={1}
                    >
                      {month.label}
                    </Text>
                  ))}
                </YStack>
              </XStack>

              <XStack gap={CELL_GAP}>
                <YStack w={WEEKDAY_LABEL_WIDTH} gap={CELL_GAP}>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Text key={index} h={CELL} lh={CELL} fos={10} color="$color" opacity={0.5}>
                      {label}
                    </Text>
                  ))}
                </YStack>

                <XStack gap={CELL_GAP}>
                  {weeks.map((week, weekIndex) => (
                    <YStack key={weekIndex} gap={CELL_GAP}>
                      {week.days.map((day) => (
                        <YStack
                          key={day.key}
                          w={CELL}
                          h={CELL}
                          br={2}
                          bg={
                            day.level === 0
                              ? "$background"
                              : LEVEL_BACKGROUNDS[day.level - 1]
                          }
                          opacity={day.isFuture ? 0 : 1}
                        />
                      ))}
                    </YStack>
                  ))}
                </XStack>
              </XStack>
            </YStack>
          </ScrollView>

          <XStack ai="center" jc="flex-end" gap={5}>
            <Text color="$color" opacity={0.5} fos={10}>
              Less
            </Text>
            <YStack w={10} h={10} br={2} bg="$background" />
            {LEVEL_BACKGROUNDS.map((background) => (
              <YStack key={background} w={10} h={10} br={2} bg={background} />
            ))}
            <Text color="$color" opacity={0.5} fos={10}>
              More
            </Text>
          </XStack>
        </YStack>
      </Group>
    </YStack>
  );
}
