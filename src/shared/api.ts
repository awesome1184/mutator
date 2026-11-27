// Request / response shapes shared by the Devvit server and the web client.

import type { MutationId, Puzzle } from './engine/types.ts';

export type Result = {
  date: string;
  moves: number;
  par: number;
  stars: 1 | 2 | 3;
  /** Undos + restarts used before the final solve. */
  rewinds: number;
  clean: boolean;
  route: string;
  /** Unix ms when the solve was recorded. */
  at: number;
};

export type Profile = {
  solved: number;
  stars: number;
  parCount: number;
  cleanCount: number;
  /** Current streak (already zeroed when it has lapsed). */
  streak: number;
  best: number;
  last: string | null;
  /** Mutations seen in solved puzzles. */
  seen: MutationId[];
  badges: string[];
  flair: boolean;
};

export type DayStats = {
  solvers: number;
  parCount: number;
  cleanCount: number;
  /** moves -> number of players */
  dist: Record<string, number>;
};

export type BoardEntry = {
  rank: number;
  name: string;
  moves: number;
  rewinds: number;
  stars: number;
  avatar: string | null;
};

export type VoteInfo = {
  /** The date whose community slot is being decided. */
  forDate: string;
  candidates: MutationId[];
  tallies: Record<string, number>;
  mine: MutationId | null;
  open: boolean;
};

export type StateResponse = {
  type: 'state';
  date: string;
  today: string;
  /** Unix ms of the next daily rollover. */
  nextAt: number;
  puzzle: Puzzle;
  user: { name: string | null; avatar: string | null };
  me: Profile | null;
  result: Result | null;
  day: DayStats;
  board: { top: BoardEntry[]; mine: BoardEntry | null };
  vote: VoteInfo | null;
};

export type SubmitRequest = {
  date: string;
  route: string;
  rewinds: number;
};

export type SubmitResponse = {
  type: 'submit';
  /** False when the route does not actually solve the puzzle. */
  accepted: boolean;
  /** True when this was the player's first (ranked) solve of the day. */
  ranked: boolean;
  result: Result | null;
  me: Profile | null;
  day: DayStats;
  board: { top: BoardEntry[]; mine: BoardEntry | null };
  newBadges: string[];
  /** The full puzzle including the par route, sent once solved. */
  puzzle: Puzzle | null;
  error?: string;
};

export type VoteRequest = { mutation: MutationId };

export type StreakEntry = { rank: number; name: string; streak: number; avatar: string | null };

export type LeaderboardResponse = {
  type: 'leaderboard';
  date: string;
  day: BoardEntry[];
  streaks: StreakEntry[];
};

export type ArchiveEntry = {
  date: string;
  number: number;
  mutations: MutationId[];
  postId: string | null;
  solvers: number;
  myStars: number | null;
};

export type ArchiveResponse = { type: 'archive'; days: ArchiveEntry[] };

export type ActionResponse = { ok: boolean; message: string };

export type ErrorResponse = { status: 'error'; message: string };
