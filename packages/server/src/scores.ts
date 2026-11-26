import { DatabaseSync } from 'node:sqlite';

export interface Guest {
  key: string;
  name: string;
  userId: null;
}

/** 主机上的战绩簿。房间与手牌只驻留内存。 */
export class Scores {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        player_key TEXT NOT NULL, seat_name TEXT NOT NULL, won INTEGER NOT NULL,
        score INTEGER NOT NULL, players INTEGER NOT NULL, finished_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS matches_player ON matches(player_key);
      CREATE TABLE IF NOT EXISTS rounds (player_key TEXT PRIMARY KEY, won INTEGER NOT NULL);
    `);
  }

  recordRoundWin(key: string) {
    this.db.prepare('INSERT INTO rounds VALUES (?, 1) ON CONFLICT(player_key) DO UPDATE SET won=won+1').run(key);
  }

  recordMatch(key: string, name: string, won: boolean, points: number, players: number) {
    this.db.prepare('INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?)').run(key, name, +won, points, players, Date.now());
  }

  profile(key: string) {
    const stats = this.db.prepare(`SELECT COUNT(*) games_played, COALESCE(SUM(won),0) games_won,
      COALESCE(SUM(score),0) points, COALESCE((SELECT won FROM rounds WHERE player_key=?),0) rounds_won
      FROM matches WHERE player_key=?`).get(key, key);
    const recent = this.db.prepare('SELECT * FROM matches WHERE player_key=? ORDER BY rowid DESC LIMIT 10').all(key);
    return { stats, recent };
  }

  leaderboard() {
    return this.db.prepare(`SELECT m.player_key,
      (SELECT seat_name FROM matches n WHERE n.player_key=m.player_key ORDER BY n.rowid DESC LIMIT 1) name,
      COUNT(*) games_played, SUM(m.won) games_won, SUM(score) points, COALESCE(r.won,0) rounds_won
      FROM matches m LEFT JOIN rounds r ON m.player_key=r.player_key
      GROUP BY m.player_key ORDER BY points DESC, games_won DESC LIMIT 20`).all();
  }
}
