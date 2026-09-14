"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  Flame,
  LogIn,
  LogOut,
  Medal,
  NotebookPen,
  Shield,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  entriesCollectionRef,
  firebaseAuth,
  firestoreDb,
  googleAuthProvider,
  isFirebaseConfigured,
  playersCollectionRef,
  teamDocRef,
} from "@/lib/firebase";

type Player = {
  id: string;
  name: string;
  jerseyNumber: string;
};

type WorkoutEntry = {
  id: string;
  playerId: string;
  season: string;
  workoutType: string;
  workoutDate: string;
  score: number;
  makes: number;
  attempts: number;
  notes: string;
  createdAt: string;
};

type AppState = {
  players: Player[];
  entries: WorkoutEntry[];
  seasons: string[];
  selectedSeason: string;
  selectedPlayerId: string | null;
};

type Summary = {
  workouts: number;
  totalScore: number;
  averageScore: number;
  makes: number;
  attempts: number;
  percentage: number;
};

type DrillLeaderboardRow = {
  player: Player;
  summary: Summary;
  bestScore: number | null;
  rank: number | null;
};

type MobilePanel = "log" | "roster" | "insights";

const DEFAULT_DRILL = "Ladder";
const DRILL_OPTIONS = [DEFAULT_DRILL, "And 1", "Ducks Shooting", "Panther 100"];

const STORAGE_KEY = "shooting-ladder:v1";
const ADMIN_EMAIL = "gamblin.matt@gmail.com";

function createId() {
  return `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function getCurrentSeason() {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const nextYear = (year + 1).toString().slice(-2);
  return `${year}-${nextYear}`;
}

function getTodayDateString() {
  const now = new Date();
  const offsetMilliseconds = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMilliseconds).toISOString().slice(0, 10);
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "unknown";
}

function getDefaultState(): AppState {
  const season = getCurrentSeason();

  return {
    players: [],
    entries: [],
    seasons: [season],
    selectedSeason: season,
    selectedPlayerId: null,
  };
}

function normalizeStoredState(storedState: Partial<AppState>): AppState {
  const defaultState = getDefaultState();
  const seasons = Array.from(
    new Set([...(storedState.seasons ?? []), defaultState.selectedSeason]),
  );
  const players = (storedState.players ?? []).map((player) => ({
    id: player.id,
    name: player.name,
    jerseyNumber: player.jerseyNumber,
  }));
  const selectedPlayerId = players.some(
    (player) => player.id === storedState.selectedPlayerId,
  )
    ? storedState.selectedPlayerId ?? null
    : players[0]?.id ?? null;

  return {
    players,
    entries: storedState.entries ?? [],
    seasons,
    selectedSeason: seasons.includes(storedState.selectedSeason ?? "")
      ? (storedState.selectedSeason as string)
      : defaultState.selectedSeason,
    selectedPlayerId,
  };
}

function summarizeEntries(entries: WorkoutEntry[]): Summary {
  const totals = entries.reduce(
    (accumulator, entry) => {
      accumulator.workouts += 1;
      accumulator.totalScore += entry.score;
      accumulator.makes += entry.makes;
      accumulator.attempts += entry.attempts;
      return accumulator;
    },
    { workouts: 0, totalScore: 0, makes: 0, attempts: 0 },
  );

  return {
    workouts: totals.workouts,
    totalScore: totals.totalScore,
    averageScore: totals.workouts ? totals.totalScore / totals.workouts : 0,
    makes: totals.makes,
    attempts: totals.attempts,
    percentage: totals.attempts ? (totals.makes / totals.attempts) * 100 : 0,
  };
}

function normalizeDrillName(name: string) {
  return name.trim().toLowerCase();
}

function getDrillEntries(entries: WorkoutEntry[], drillName: string) {
  const normalizedDrillName = normalizeDrillName(drillName);

  return entries.filter(
    (entry) => normalizeDrillName(entry.workoutType) === normalizedDrillName,
  );
}

function getDistinctDrills(entries: WorkoutEntry[]) {
  return Array.from(
    new Set([
      ...DRILL_OPTIONS,
      ...entries.map((entry) => entry.workoutType.trim()).filter(Boolean),
    ]),
  );
}

function buildDrillLeaderboardRows(
  players: Player[],
  drillEntries: WorkoutEntry[],
): DrillLeaderboardRow[] {
  const rows = players.map((player) => {
    const playerDrillEntries = drillEntries.filter(
      (entry) => entry.playerId === player.id,
    );
    const summary = summarizeEntries(playerDrillEntries);

    return {
      player,
      summary,
      bestScore: summary.workouts
        ? playerDrillEntries.reduce((best, entry) => Math.max(best, entry.score), 0)
        : null,
      rank: null,
    };
  });

  const activeRows = rows
    .filter((row) => row.summary.workouts > 0)
    .sort((left, right) => {
      if ((right.bestScore ?? 0) !== (left.bestScore ?? 0)) {
        return (right.bestScore ?? 0) - (left.bestScore ?? 0);
      }

      if (right.summary.averageScore !== left.summary.averageScore) {
        return right.summary.averageScore - left.summary.averageScore;
      }

      return right.summary.totalScore - left.summary.totalScore;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const inactiveRows = rows
    .filter((row) => row.summary.workouts === 0)
    .sort((left, right) => left.player.name.localeCompare(right.player.name));

  return [...activeRows, ...inactiveRows];
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatAverage(value: number) {
  return value.toFixed(1);
}

function getDefaultPlayerNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "Player";
  const words = localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return "Player";
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function StatCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/85 p-4 text-white shadow-[0_18px_45px_rgba(2,6,23,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
            {label}
          </div>
          <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
        </div>
        <div className={`rounded-2xl border px-3 py-3 ${accent}`}>{icon}</div>
      </div>
      <div className="mt-3 text-sm text-slate-400">{detail}</div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2.5 text-amber-300">
        {icon}
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/${compact ? "5" : "95"} ${
        compact ? "p-3" : "p-4 sm:p-5"
      } shadow-[0_16px_40px_rgba(2,6,23,0.22)]`}
    >
      <Image
        src={compact ? "/TTB White.png" : "/Top Tier Basketball.png"}
        alt={compact ? "Top Tier Basketball mark" : "Top Tier Basketball logo"}
        width={compact ? 435 : 2048}
        height={compact ? 301 : 755}
        className={`h-auto w-full ${compact ? "max-w-[180px]" : "max-w-[520px]"}`}
        priority
      />
    </div>
  );
}

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [entries, setEntries] = useState<WorkoutEntry[]>([]);
  const [seasons, setSeasons] = useState<string[]>([getCurrentSeason()]);
  const [selectedSeason, setSelectedSeason] = useState(getCurrentSeason());
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [emailForm, setEmailForm] = useState({
    email: "",
    password: "",
  });
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("log");
  const [playerForm, setPlayerForm] = useState({
    name: "",
    jerseyNumber: "",
  });
  const [seasonForm, setSeasonForm] = useState(getCurrentSeason());
  const [entryForm, setEntryForm] = useState({
    workoutType: DEFAULT_DRILL,
    workoutDate: getTodayDateString(),
    score: "",
    makes: "",
    attempts: "",
    notes: "",
  });
  const lastSyncedLocalStateRef = useRef<string | null>(null);

  const isAdmin = authUser?.email?.toLowerCase() === ADMIN_EMAIL;
  const canUseSharedApp = !isFirebaseConfigured || Boolean(authUser);
  const canManageTeam = !isFirebaseConfigured || isAdmin;
  const canLogWorkout = !isFirebaseConfigured || Boolean(authUser);

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthReady(true);
      return;
    }

    const authInstance = firebaseAuth;

    const unsubscribe = onAuthStateChanged(
      authInstance,
      (nextUser) => {
        if (nextUser && nextUser.email?.toLowerCase() !== ADMIN_EMAIL) {
          setAuthUser(null);
          setAuthError("Only the coach account can sign in to this app.");
          setAuthReady(true);
          void signOut(authInstance);
          return;
        }

        setAuthUser(nextUser);
        setAuthError(null);
        setAuthReady(true);
      },
      () => {
        setAuthUser(null);
        setAuthError("Authentication could not be loaded. Refresh and try again.");
        setAuthReady(true);
      },
    );

    return unsubscribe;
  }, []);

  // Each collection is its own listener so a save can only ever touch its own document.
  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    if (!authReady) {
      return;
    }

    if (!authUser || !teamDocRef || !playersCollectionRef || !entriesCollectionRef) {
      setHydrated(true);
      setPersistenceReady(false);
      return;
    }

    const loadedFlags = { team: false, players: false, entries: false };
    const markLoaded = (key: keyof typeof loadedFlags) => {
      loadedFlags[key] = true;
      if (loadedFlags.team && loadedFlags.players && loadedFlags.entries) {
        setHydrated(true);
        setPersistenceReady(true);
      }
    };

    const unsubscribeTeam = onSnapshot(
      teamDocRef,
      (snapshot) => {
        const data = snapshot.data() as { seasons?: string[] } | undefined;
        const nextSeasons = data?.seasons?.length ? data.seasons : [getCurrentSeason()];
        setSeasons(nextSeasons);
        setSelectedSeason((current) => (nextSeasons.includes(current) ? current : nextSeasons[0]));
        markLoaded("team");
      },
      (error) => {
        setAuthError(`Connected to Firebase, but team settings could not be loaded (${getErrorCode(error)}).`);
        markLoaded("team");
      },
    );

    const unsubscribePlayers = onSnapshot(
      playersCollectionRef,
      (snapshot) => {
        setPlayers(
          snapshot.docs.map((playerDoc) => ({
            id: playerDoc.id,
            ...(playerDoc.data() as Omit<Player, "id">),
          })),
        );
        markLoaded("players");
      },
      (error) => {
        setAuthError(`Connected to Firebase, but the roster could not be loaded (${getErrorCode(error)}).`);
        markLoaded("players");
      },
    );

    const unsubscribeEntries = onSnapshot(
      entriesCollectionRef,
      (snapshot) => {
        setEntries(
          snapshot.docs.map((entryDoc) => ({
            id: entryDoc.id,
            ...(entryDoc.data() as Omit<WorkoutEntry, "id">),
          })),
        );
        markLoaded("entries");
      },
      (error) => {
        setAuthError(`Connected to Firebase, but workout entries could not be loaded (${getErrorCode(error)}).`);
        markLoaded("entries");
      },
    );

    return () => {
      unsubscribeTeam();
      unsubscribePlayers();
      unsubscribeEntries();
    };
  }, [authReady, authUser]);

  // Local-only fallback when Firebase isn't configured (no shared multi-device sync).
  useEffect(() => {
    if (isFirebaseConfigured) {
      return;
    }

    try {
      const storedState = window.localStorage.getItem(STORAGE_KEY);

      if (storedState) {
        const normalizedState = normalizeStoredState(JSON.parse(storedState) as Partial<AppState>);
        lastSyncedLocalStateRef.current = JSON.stringify(normalizedState);
        setPlayers(normalizedState.players);
        setEntries(normalizedState.entries);
        setSeasons(normalizedState.seasons);
        setSelectedSeason(normalizedState.selectedSeason);
        setSelectedPlayerId(normalizedState.selectedPlayerId);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
      setPersistenceReady(true);
    }
  }, []);

  useEffect(() => {
    if (isFirebaseConfigured || !hydrated || !persistenceReady) {
      return;
    }

    const combinedState: AppState = { players, entries, seasons, selectedSeason, selectedPlayerId };
    const serializedState = JSON.stringify(combinedState);

    if (serializedState === lastSyncedLocalStateRef.current) {
      return;
    }

    lastSyncedLocalStateRef.current = serializedState;
    window.localStorage.setItem(STORAGE_KEY, serializedState);
  }, [hydrated, persistenceReady, players, entries, seasons, selectedSeason, selectedPlayerId]);

  const authFallbackPlayer = authUser
    ? {
        id: `user:${authUser.uid}`,
        name:
          authUser.displayName?.trim() ||
          (authUser.email ? getDefaultPlayerNameFromEmail(authUser.email) : "Player"),
        jerseyNumber: "",
      }
    : null;
  const loggablePlayers = authFallbackPlayer
    ? players.some((player) => player.id === authFallbackPlayer.id)
      ? players
      : [...players, authFallbackPlayer]
    : players;
  const selectedPlayer =
    loggablePlayers.find((player) => player.id === selectedPlayerId) ??
    (loggablePlayers[0] ?? null);
  const seasonEntries = entries.filter((entry) => entry.season === selectedSeason);
  const teamSeasonSummary = summarizeEntries(seasonEntries);
  const teamCareerSummary = summarizeEntries(entries);
  const recentEntries = [...entries]
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))
    .slice(0, 8);

  const leaderboard = players
    .map((player) => {
      const careerEntries = entries.filter((entry) => entry.playerId === player.id);
      const selectedSeasonEntries = careerEntries.filter(
        (entry) => entry.season === selectedSeason,
      );

      return {
        player,
        season: summarizeEntries(selectedSeasonEntries),
        career: summarizeEntries(careerEntries),
      };
    })
    .sort((left, right) => {
      if (right.season.averageScore !== left.season.averageScore) {
        return right.season.averageScore - left.season.averageScore;
      }

      return right.season.totalScore - left.season.totalScore;
    });

  const selectedPlayerSeasonSummary = selectedPlayer
    ? summarizeEntries(
        entries.filter(
          (entry) => entry.playerId === selectedPlayer.id && entry.season === selectedSeason,
        ),
      )
    : summarizeEntries([]);
  const selectedPlayerCareerSummary = selectedPlayer
    ? summarizeEntries(entries.filter((entry) => entry.playerId === selectedPlayer.id))
    : summarizeEntries([]);
  const todayDate = getTodayDateString();
  const drillLeaderboards = getDistinctDrills(entries).map((drillName) => {
    const allTimeEntries = getDrillEntries(entries, drillName);
    const todayEntries = allTimeEntries.filter((entry) => entry.workoutDate === todayDate);

    return {
      drillName,
      allTimeRows: buildDrillLeaderboardRows(players, allTimeEntries),
      todayRows: buildDrillLeaderboardRows(players, todayEntries),
    };
  });

  const mobilePanelButtonClass = (panel: MobilePanel) =>
    `flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
      mobilePanel === panel
        ? "bg-amber-500 text-slate-950 shadow-[0_12px_24px_rgba(245,158,11,0.24)]"
        : "bg-white/5 text-slate-300 hover:bg-white/10"
    }`;

  const panelVisibilityClass = (panel: MobilePanel) =>
    mobilePanel === panel ? "block" : "hidden";

  async function handleAddPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = playerForm.name.trim();
    if (!name) {
      return;
    }

    const nextPlayer = { name, jerseyNumber: playerForm.jerseyNumber.trim() };

    if (isFirebaseConfigured && playersCollectionRef) {
      try {
        const newPlayerRef = doc(playersCollectionRef);
        await setDoc(newPlayerRef, nextPlayer);
        setSelectedPlayerId((current) => current ?? newPlayerRef.id);
      } catch (error) {
        setAuthError(`Could not add player (${getErrorCode(error)}).`);
      }
    } else {
      const newPlayer: Player = { id: createId(), ...nextPlayer };
      setPlayers((current) => [...current, newPlayer]);
      setSelectedPlayerId((current) => current ?? newPlayer.id);
    }

    setPlayerForm({ name: "", jerseyNumber: "" });
  }

  async function handleRemovePlayer(playerId: string) {
    if (isFirebaseConfigured && playersCollectionRef && entriesCollectionRef && firestoreDb) {
      try {
        const playersRef = playersCollectionRef;
        const entriesRef = entriesCollectionRef;
        const batch = writeBatch(firestoreDb);
        batch.delete(doc(playersRef, playerId));
        entries
          .filter((entry) => entry.playerId === playerId)
          .forEach((entry) => batch.delete(doc(entriesRef, entry.id)));
        await batch.commit();
        setSelectedPlayerId((current) => (current === playerId ? null : current));
      } catch (error) {
        setAuthError(`Could not remove player (${getErrorCode(error)}).`);
      }
      return;
    }

    setPlayers((current) => current.filter((player) => player.id !== playerId));
    setEntries((current) => current.filter((entry) => entry.playerId !== playerId));
    setSelectedPlayerId((current) => (current === playerId ? null : current));
  }

  async function handleAddSeason(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const season = seasonForm.trim();
    if (!season) {
      return;
    }

    const nextSeasons = seasons.includes(season) ? seasons : [...seasons, season].sort();

    if (isFirebaseConfigured && teamDocRef) {
      try {
        await setDoc(teamDocRef, { seasons: nextSeasons }, { merge: true });
      } catch (error) {
        setAuthError(`Could not save season (${getErrorCode(error)}).`);
      }
    } else {
      setSeasons(nextSeasons);
    }

    setSelectedSeason(season);
  }

  async function handleLogWorkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPlayer) {
      return;
    }

    const score = Number(entryForm.score);
    const makes = Number(entryForm.makes);
    const attempts = Number(entryForm.attempts);

    if (
      Number.isNaN(score) ||
      Number.isNaN(makes) ||
      Number.isNaN(attempts) ||
      attempts < makes ||
      attempts <= 0
    ) {
      return;
    }

    const nextEntry = {
      playerId: selectedPlayer.id,
      season: selectedSeason,
      workoutType: entryForm.workoutType.trim() || DEFAULT_DRILL,
      workoutDate: entryForm.workoutDate,
      score,
      makes,
      attempts,
      notes: entryForm.notes.trim(),
      createdAt: new Date().toISOString(),
    };

    const hasPlayer = players.some((player) => player.id === selectedPlayer.id);

    if (isFirebaseConfigured && entriesCollectionRef && playersCollectionRef) {
      try {
        if (!hasPlayer) {
          await setDoc(doc(playersCollectionRef, selectedPlayer.id), {
            name: selectedPlayer.name,
            jerseyNumber: selectedPlayer.jerseyNumber,
          });
        }
        await addDoc(entriesCollectionRef, nextEntry);
        setSelectedPlayerId(selectedPlayer.id);
      } catch (error) {
        setAuthError(`Save failed (${getErrorCode(error)}). Check Firestore permissions.`);
      }
    } else {
      setPlayers((current) => (hasPlayer ? current : [...current, selectedPlayer]));
      setEntries((current) => [...current, { id: createId(), ...nextEntry }]);
      setSelectedPlayerId(selectedPlayer.id);
    }

    setEntryForm((currentForm) => ({
      ...currentForm,
      score: "",
      makes: "",
      attempts: "",
      notes: "",
    }));
  }

  function clearAllData() {
    if (isFirebaseConfigured) {
      // Shared team data lives in Firestore; remove players/entries individually instead.
      setSelectedPlayerId(null);
      return;
    }

    const resetState = getDefaultState();
    setPlayers(resetState.players);
    setEntries(resetState.entries);
    setSeasons(resetState.seasons);
    setSelectedSeason(resetState.selectedSeason);
    setSelectedPlayerId(resetState.selectedPlayerId);
    setSeasonForm(resetState.selectedSeason);
  }

  async function handleSignIn() {
    if (!firebaseAuth || !googleAuthProvider) {
      return;
    }

    try {
      setAuthBusy(true);
      setAuthError(null);
      await signInWithPopup(firebaseAuth, googleAuthProvider);
    } catch {
      setAuthError("Google sign-in did not complete. Try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleEmailSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firebaseAuth) {
      return;
    }

    const email = emailForm.email.trim();
    const password = emailForm.password;

    if (!email || !password) {
      setAuthError("Enter both email and password.");
      return;
    }

    try {
      setAuthBusy(true);
      setAuthError(null);
      await signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch {
      setAuthError("Email sign-in failed. Check your credentials and try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (!firebaseAuth) {
      return;
    }

    try {
      await signOut(firebaseAuth);
    } catch {
      setAuthError("Sign-out failed. Refresh the page and try again.");
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0,#0f172a_42%,#020617_100%)] pb-24 text-white">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/92 p-6 shadow-[0_24px_90px_rgba(2,6,23,0.42)] backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <BrandLockup />
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-300">
                Year-round shooting development
              </p>
            </div>

            <div className="flex w-full max-w-[28rem] flex-col gap-3 lg:items-end">
              {isFirebaseConfigured ? (
                <div className="w-full rounded-[1.6rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_45px_rgba(2,6,23,0.22)]">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          Team access
                        </div>
                        {authUser ? (
                          <div className="mt-2">
                            <div className="font-semibold text-white">{authUser.email}</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                                Signed in
                              </span>
                              {isAdmin ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                                  <Shield className="h-3.5 w-3.5" /> Coach admin
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-300">
                            Sign in with Google or your email/password account to access the shared team dashboard.
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={authUser ? handleSignOut : handleSignIn}
                        disabled={authBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {authUser ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                        {authUser ? "Sign out" : "Sign in with Google"}
                      </button>
                    </div>

                    {!authUser ? (
                      <form onSubmit={handleEmailSignIn} className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end">
                        <label className="grid gap-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                            Email
                          </span>
                          <input
                            type="email"
                            autoComplete="email"
                            value={emailForm.email}
                            onChange={(event) =>
                              setEmailForm((currentForm) => ({
                                ...currentForm,
                                email: event.target.value,
                              }))
                            }
                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400"
                            placeholder="coach@school.edu"
                          />
                        </label>

                        <label className="grid gap-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                            Password
                          </span>
                          <input
                            type="password"
                            autoComplete="current-password"
                            value={emailForm.password}
                            onChange={(event) =>
                              setEmailForm((currentForm) => ({
                                ...currentForm,
                                password: event.target.value,
                              }))
                            }
                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400"
                            placeholder="Password"
                          />
                        </label>

                        <button
                          type="submit"
                          disabled={authBusy}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {authBusy ? "Signing in..." : "Sign in with email"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                  {authError ? (
                    <p className="mt-3 text-sm text-rose-300">{authError}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="hidden w-full grid-cols-2 gap-3 sm:grid sm:grid-cols-4">
                <StatCard
                  label="Roster"
                  value={players.length}
                  detail="Players currently loaded"
                  icon={<Users className="h-5 w-5" />}
                  accent="border-sky-400/20 bg-sky-400/10 text-sky-300"
                />
                <StatCard
                  label="Season"
                  value={selectedSeason}
                  detail="Current leaderboard scope"
                  icon={<CalendarRange className="h-5 w-5" />}
                  accent="border-amber-400/20 bg-amber-400/10 text-amber-300"
                />
                <StatCard
                  label="Entries"
                  value={entries.length}
                  detail="Logged workouts in browser"
                  icon={<NotebookPen className="h-5 w-5" />}
                  accent="border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                />
                <StatCard
                  label="Career Avg"
                  value={formatAverage(teamCareerSummary.averageScore)}
                  detail="Average score across all seasons"
                  icon={<Flame className="h-5 w-5" />}
                  accent="border-rose-400/20 bg-rose-400/10 text-rose-300"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/85 p-3 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:hidden">
          <div className="flex gap-2 rounded-full border border-white/10 bg-white/5 p-1">
            <button type="button" onClick={() => setMobilePanel("log")} className={mobilePanelButtonClass("log")}>
              Log
            </button>
            <button type="button" onClick={() => setMobilePanel("roster")} className={mobilePanelButtonClass("roster")}>
              Roster
            </button>
            <button type="button" onClick={() => setMobilePanel("insights")} className={mobilePanelButtonClass("insights")}>
              Insights
            </button>
          </div>
        </section>

        {isFirebaseConfigured && !authReady ? (
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/80 px-5 py-4 text-sm text-slate-300 shadow-[0_18px_48px_rgba(2,6,23,0.28)]">
            Checking Google sign-in status.
          </section>
        ) : null}

        {isFirebaseConfigured && authReady && !authUser ? (
          <section className="rounded-[2rem] border border-amber-400/20 bg-amber-400/10 px-5 py-4 text-sm text-amber-100 shadow-[0_18px_48px_rgba(2,6,23,0.18)]">
            Sign in with your Google account to load the shared Top Tier Basketball team data.
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className={`${panelVisibilityClass("roster")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <div className="flex items-center justify-between gap-4">
                <SectionHeading
                  icon={<Users className="h-5 w-5" />}
                  title="Roster"
                  subtitle="Manage the roster here and choose the active player for workout logging."
                />
                <button
                  type="button"
                  onClick={clearAllData}
                  disabled={!canManageTeam}
                  className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-amber-400/40 hover:text-white"
                >
                  Reset app
                </button>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Active player
                </label>
                <select
                  value={selectedPlayerId ?? ""}
                  onChange={(event) => setSelectedPlayerId(event.target.value || null)}
                  disabled={!canLogWorkout}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400"
                >
                  <option value="" disabled className="bg-slate-950 text-slate-300">
                    Select player
                  </option>
                  {players.map((player) => (
                    <option
                      key={player.id}
                      value={player.id}
                      className="bg-slate-950 text-white"
                    >
                      {player.name}
                      {player.jerseyNumber ? ` #${player.jerseyNumber}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <form onSubmit={handleAddPlayer} className="mt-5 grid gap-3 sm:grid-cols-4">
                <input
                  value={playerForm.name}
                  onChange={(event) =>
                    setPlayerForm((currentForm) => ({
                      ...currentForm,
                      name: event.target.value,
                    }))
                  }
                  disabled={!canManageTeam}
                  placeholder="Player name"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-0 transition placeholder:text-slate-500 focus:border-amber-400"
                />
                <input
                  value={playerForm.jerseyNumber}
                  onChange={(event) =>
                    setPlayerForm((currentForm) => ({
                      ...currentForm,
                      jerseyNumber: event.target.value,
                    }))
                  }
                  disabled={!canManageTeam}
                  placeholder="Jersey"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-0 transition placeholder:text-slate-500 focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={!canManageTeam}
                  className="rounded-2xl bg-amber-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-amber-400"
                >
                  Add player
                </button>
              </form>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {players.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/12 bg-white/5 px-5 py-10 text-sm text-slate-400 sm:col-span-2 xl:col-span-3">
                    Start by adding your roster. Once players are listed here, they can tap their name and log workouts from the home screen.
                  </div>
                ) : null}

                {leaderboard.map(({ player, season }) => {
                  const isSelected = player.id === selectedPlayer?.id;

                  return (
                    <div
                      key={player.id}
                      className={`rounded-3xl border p-4 transition ${
                        isSelected
                          ? "border-amber-400/40 bg-amber-400/10 text-white"
                          : "border-white/10 bg-slate-900/70 text-white hover:border-amber-400/30"
                      }`}
                    >
                      <div className="w-full text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-bold">{player.name}</div>
                            <div
                              className={`text-sm ${
                                isSelected ? "text-amber-100/80" : "text-slate-400"
                              }`}
                            >
                              #{player.jerseyNumber || "--"}
                            </div>
                          </div>
                          <div
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              isSelected
                                ? "bg-white/10 text-white"
                                : "bg-amber-400/10 text-amber-300"
                            }`}
                          >
                            {season.workouts} workouts
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <div className={isSelected ? "text-amber-100/70" : "text-slate-400"}>Avg</div>
                            <div className="text-lg font-semibold">
                              {formatAverage(season.averageScore)}
                            </div>
                          </div>
                          <div>
                            <div className={isSelected ? "text-amber-100/70" : "text-slate-400"}>Total</div>
                            <div className="text-lg font-semibold">{season.totalScore}</div>
                          </div>
                          <div>
                            <div className={isSelected ? "text-amber-100/70" : "text-slate-400"}>FG%</div>
                            <div className="text-lg font-semibold">
                              {formatPercent(season.percentage)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePlayer(player.id)}
                        disabled={!canManageTeam}
                        className={`mt-4 text-sm font-semibold ${
                          isSelected ? "text-rose-200 hover:text-white" : "text-rose-300 hover:text-rose-200"
                        }`}
                      >
                        Remove player
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`${panelVisibilityClass("roster")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <SectionHeading
                  icon={<CalendarRange className="h-5 w-5" />}
                  title="Season control"
                  subtitle="Track one season at a time while keeping career totals underneath."
                />

                <div className="flex flex-wrap gap-2">
                  {seasons.map((season) => (
                    <button
                      key={season}
                      type="button"
                      onClick={() => setSelectedSeason(season)}
                      disabled={!canUseSharedApp}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        season === selectedSeason
                          ? "bg-amber-500 text-slate-950"
                          : "bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {season}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleAddSeason} className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  value={seasonForm}
                  onChange={(event) => setSeasonForm(event.target.value)}
                  disabled={!canManageTeam}
                  placeholder="Add season like 2027-28"
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={!canManageTeam}
                  className="rounded-2xl bg-amber-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-400"
                >
                  Save season
                </button>
              </form>
            </div>

            <div className={`${panelVisibilityClass("insights")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <div className="flex items-center justify-between">
                <SectionHeading
                  icon={<Trophy className="h-5 w-5" />}
                  title="Leaderboards"
                  subtitle="Ranked by current-season average, then current-season total score."
                />
              </div>

              <div className="mt-5 overflow-hidden rounded-3xl border border-white/10">
                <div className="grid grid-cols-[0.5fr_1.8fr_1fr_1fr_1fr] bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
                  <span>Rank</span>
                  <span>Player</span>
                  <span>Avg</span>
                  <span>Total</span>
                  <span>FG%</span>
                </div>

                {leaderboard.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-slate-400">
                    Add players and workouts to populate season leaderboards.
                  </div>
                ) : (
                  leaderboard.map(({ player, season }, index) => (
                    <div
                      key={player.id}
                      className="grid grid-cols-[0.5fr_1.8fr_1fr_1fr_1fr] items-center border-t border-white/10 px-4 py-4 text-sm text-slate-200"
                    >
                      <span className="font-bold text-white">{index + 1}</span>
                      <span className="font-semibold text-slate-100">{player.name}</span>
                      <span>{formatAverage(season.averageScore)}</span>
                      <span>{season.totalScore}</span>
                      <span>{formatPercent(season.percentage)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={`${panelVisibilityClass("insights")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <SectionHeading
                icon={<Target className="h-5 w-5" />}
                title="Drill leaderboards"
                subtitle="Today and all-time rankings for each drill across the full roster."
              />

              <div className="mt-5 space-y-4">
                {drillLeaderboards.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/12 bg-white/5 px-4 py-8 text-sm text-slate-400">
                    Log Ladder and the other drill types to generate drill-specific leaderboards.
                  </div>
                ) : (
                  drillLeaderboards.map(({ drillName, todayRows, allTimeRows }) => (
                    <div
                      key={drillName}
                      className="overflow-hidden rounded-3xl border border-white/10 bg-white/5"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div>
                          <div className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">
                            {drillName}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Full roster view including players with no logged entries
                          </div>
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {players.length} players
                        </div>
                      </div>

                      <div className="grid gap-4 p-4">
                        <div className="overflow-hidden rounded-2xl border border-white/10">
                          <div className="border-b border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
                            Today ({todayDate})
                          </div>
                          <div className="grid grid-cols-[0.55fr_1.8fr_0.8fr_0.8fr_0.9fr] bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
                            <span>Rank</span>
                            <span>Player</span>
                            <span>Best</span>
                            <span>Avg</span>
                            <span>Workouts</span>
                          </div>
                          {todayRows.map(({ player, summary, bestScore, rank }) => (
                            <div
                              key={`${drillName}-today-${player.id}`}
                              className="grid grid-cols-[0.55fr_1.8fr_0.8fr_0.8fr_0.9fr] items-center border-t border-white/10 px-4 py-2.5 text-sm text-slate-200"
                            >
                              <span className="font-bold text-white">{rank ?? "-"}</span>
                              <span className="font-semibold text-slate-100">{player.name}</span>
                              <span className="font-semibold text-white">{bestScore ?? "--"}</span>
                              <span>{summary.workouts ? formatAverage(summary.averageScore) : "--"}</span>
                              <span>{summary.workouts}</span>
                            </div>
                          ))}
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-white/10">
                          <div className="border-b border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-sky-300">
                            All time
                          </div>
                          <div className="grid grid-cols-[0.55fr_1.8fr_0.8fr_0.8fr_0.9fr] bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
                            <span>Rank</span>
                            <span>Player</span>
                            <span>Best</span>
                            <span>Avg</span>
                            <span>Workouts</span>
                          </div>
                          {allTimeRows.map(({ player, summary, bestScore, rank }) => (
                            <div
                              key={`${drillName}-all-${player.id}`}
                              className="grid grid-cols-[0.55fr_1.8fr_0.8fr_0.8fr_0.9fr] items-center border-t border-white/10 px-4 py-2.5 text-sm text-slate-200"
                            >
                              <span className="font-bold text-white">{rank ?? "-"}</span>
                              <span className="font-semibold text-slate-100">{player.name}</span>
                              <span className="font-semibold text-white">{bestScore ?? "--"}</span>
                              <span>{summary.workouts ? formatAverage(summary.averageScore) : "--"}</span>
                              <span>{summary.workouts}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className={`${panelVisibilityClass("log")} rounded-[2rem] border border-white/10 bg-slate-950 p-5 text-white shadow-[0_18px_48px_rgba(2,6,23,0.42)] lg:block`}>
              <SectionHeading
                icon={<NotebookPen className="h-5 w-5" />}
                title="Log a workout"
                subtitle={
                  selectedPlayer
                    ? `Recording for ${selectedPlayer.name} in ${selectedSeason}.`
                    : "Select a player first to start logging scores."
                }
              />

              <form onSubmit={handleLogWorkout} className="mt-5 space-y-3">
                <div className="grid gap-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Player
                  </label>
                  <select
                    value={selectedPlayer?.id ?? ""}
                    onChange={(event) => setSelectedPlayerId(event.target.value || null)}
                    disabled={!canLogWorkout}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400"
                  >
                    <option value="" disabled className="bg-slate-950 text-slate-300">
                      Select player
                    </option>
                    {loggablePlayers.map((player) => (
                      <option key={player.id} value={player.id} className="bg-slate-950 text-white">
                        {player.name}
                        {player.jerseyNumber ? ` #${player.jerseyNumber}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  value={entryForm.workoutType}
                  onChange={(event) =>
                    setEntryForm((currentForm) => ({
                      ...currentForm,
                      workoutType: event.target.value,
                    }))
                  }
                  disabled={!canLogWorkout}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400"
                >
                  {DRILL_OPTIONS.map((drill) => (
                    <option key={drill} value={drill} className="bg-slate-950 text-white">
                      {drill}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={entryForm.workoutDate}
                  onChange={(event) =>
                    setEntryForm((currentForm) => ({
                      ...currentForm,
                      workoutDate: event.target.value,
                    }))
                  }
                  disabled={!canLogWorkout}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400"
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    inputMode="numeric"
                    value={entryForm.score}
                    onChange={(event) =>
                      setEntryForm((currentForm) => ({
                        ...currentForm,
                        score: event.target.value,
                      }))
                    }
                    disabled={!canLogWorkout}
                    placeholder="Score"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-400 focus:border-amber-400"
                  />
                  <input
                    inputMode="numeric"
                    value={entryForm.makes}
                    onChange={(event) =>
                      setEntryForm((currentForm) => ({
                        ...currentForm,
                        makes: event.target.value,
                      }))
                    }
                    disabled={!canLogWorkout}
                    placeholder="Makes"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-400 focus:border-amber-400"
                  />
                  <input
                    inputMode="numeric"
                    value={entryForm.attempts}
                    onChange={(event) =>
                      setEntryForm((currentForm) => ({
                        ...currentForm,
                        attempts: event.target.value,
                      }))
                    }
                    disabled={!canLogWorkout}
                    placeholder="Attempts"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-400 focus:border-amber-400"
                  />
                </div>
                <textarea
                  value={entryForm.notes}
                  onChange={(event) =>
                    setEntryForm((currentForm) => ({
                      ...currentForm,
                      notes: event.target.value,
                    }))
                  }
                  disabled={!canLogWorkout}
                  placeholder="Notes: drill focus, gym, tired legs, competition segment"
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-400 focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={!selectedPlayer || !canLogWorkout}
                  className="w-full rounded-2xl bg-amber-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  Save workout
                </button>
                <p className="text-xs text-slate-500">
                  {isFirebaseConfigured
                    ? "Shared team data syncs through Firebase once you sign in with Google."
                    : "Scores persist in this browser so the app can be pinned to the phone home screen and used like a lightweight team tool."}
                </p>
              </form>
            </div>

            <div className={`${panelVisibilityClass("insights")} grid gap-4 sm:grid-cols-2 lg:grid lg:gap-4`}>
              <div className="rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)]">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Team season
                </div>
                <div className="mt-3 text-3xl font-black text-white">
                  {teamSeasonSummary.totalScore}
                </div>
                <div className="mt-2 text-sm text-slate-400">Total score in {selectedSeason}</div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-slate-400">Avg</div>
                    <div className="font-semibold text-white">
                      {formatAverage(teamSeasonSummary.averageScore)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Workouts</div>
                    <div className="font-semibold text-white">{teamSeasonSummary.workouts}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">FG%</div>
                    <div className="font-semibold text-white">
                      {formatPercent(teamSeasonSummary.percentage)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)]">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  Team career
                </div>
                <div className="mt-3 text-3xl font-black text-white">
                  {teamCareerSummary.totalScore}
                </div>
                <div className="mt-2 text-sm text-slate-400">All logged workouts across every season</div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-slate-400">Avg</div>
                    <div className="font-semibold text-white">
                      {formatAverage(teamCareerSummary.averageScore)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Makes</div>
                    <div className="font-semibold text-white">{teamCareerSummary.makes}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Attempts</div>
                    <div className="font-semibold text-white">{teamCareerSummary.attempts}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`${panelVisibilityClass("insights")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <SectionHeading
                icon={<Medal className="h-5 w-5" />}
                title="Player focus"
                subtitle={
                  selectedPlayer
                    ? `${selectedPlayer.name}'s season and career snapshot.`
                    : "Choose a player from the roster to see individual trends."
                }
              />

              {selectedPlayer ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5 text-white">
                    <div className="text-2xl font-bold">{selectedPlayer.name}</div>
                      <div className="mt-1 text-sm text-amber-100/80">
                      #{selectedPlayer.jerseyNumber || "--"}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                        {selectedSeason}
                      </div>
                      <div className="mt-3 text-3xl font-black text-white">
                        {selectedPlayerSeasonSummary.totalScore}
                      </div>
                      <div className="mt-3 text-sm text-slate-300">
                        Avg {formatAverage(selectedPlayerSeasonSummary.averageScore)} · FG% {formatPercent(selectedPlayerSeasonSummary.percentage)}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">
                        Career
                      </div>
                      <div className="mt-3 text-3xl font-black text-white">
                        {selectedPlayerCareerSummary.totalScore}
                      </div>
                      <div className="mt-3 text-sm text-slate-300">
                        Avg {formatAverage(selectedPlayerCareerSummary.averageScore)} · FG% {formatPercent(selectedPlayerCareerSummary.percentage)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`${panelVisibilityClass("insights")} rounded-[2rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_48px_rgba(2,6,23,0.28)] lg:block`}>
              <SectionHeading
                icon={<BarChart3 className="h-5 w-5" />}
                title="Recent workouts"
                subtitle="Latest entries across the whole team."
              />

              <div className="mt-5 space-y-3">
                {recentEntries.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/12 bg-white/5 px-4 py-8 text-sm text-slate-400">
                    No workouts logged yet.
                  </div>
                ) : (
                  recentEntries.map((entry) => {
                    const player = players.find(
                      (candidate) => candidate.id === entry.playerId,
                    );

                    return (
                      <div
                        key={entry.id}
                        className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold text-white">
                              {player?.name ?? "Removed player"}
                            </div>
                            <div className="text-sm text-slate-400">
                              {entry.workoutType} · {entry.workoutDate} · {entry.season}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-white">{entry.score}</div>
                            <div className="text-sm text-slate-400">
                              {entry.makes}/{entry.attempts} shots
                            </div>
                          </div>
                        </div>
                        {entry.notes ? (
                          <p className="mt-3 text-sm leading-6 text-slate-300">{entry.notes}</p>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>

        {!hydrated ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-400 backdrop-blur">
            {isFirebaseConfigured
              ? "Loading shared team data from Firebase."
              : "Loading saved team data from this device."}
          </div>
        ) : null}
      </main>
    </div>
  );
}
