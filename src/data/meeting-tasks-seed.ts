import Database from 'better-sqlite3';

// Meeting tasks seed — auto-creates tasks on startup if they don't exist
// Each batch is keyed by a unique meeting ID to avoid duplicates

interface TaskSeed {
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  category: string;
  due_date: string;
  assigned_to_username?: string;
}

interface MeetingBatch {
  meeting_id: string; // unique key to prevent re-inserting
  tasks: TaskSeed[];
}

const MEETING_TASKS: MeetingBatch[] = [
  {
    meeting_id: 'meeting-2026-04-10',
    tasks: [
      {
        title: 'CS $10K final payment - get AI legal analysis',
        description: 'Meeting 10 Apr: CS has a $10K final payment outstanding. Need AI analysis on whether to pay. Concern: Shadowcay\'s only director is Michael, worry that counterparty may sue Michael and 泰东 together in HK. Get AI analysis and discuss Monday.',
        priority: 'high',
        category: 'legal',
        due_date: '2026-04-14',
      },
      {
        title: 'Macau/HK offsite - book hotels Apr 24-28',
        description: 'Meeting 10 Apr: Evelyn organizing. Dev team Zhuhai first, then Macau. Michael goes Macau after Apr 23 only. Switched to HK Apr 24-26 due to high Macau prices (HKD 4000/night). Team book own hotels and expense. Book ASAP before May 1.',
        priority: 'medium',
        category: 'admin',
        due_date: '2026-04-18',
      },
      {
        title: '中志 deposit refund - bank verification in progress',
        description: 'Meeting 10 Apr: Sent to 中志, forwarded to bank for verification. Follow up.',
        priority: 'medium',
        category: 'finance',
        due_date: '2026-04-14',
      },
      {
        title: 'Prepare weekly report & monthly report',
        description: 'Meeting 10 Apr: Weekly - Paul to provide working papers (~30 min). Monthly - waiting on Foundation data. Close books first.',
        priority: 'high',
        category: 'reporting',
        due_date: '2026-04-11',
        assigned_to_username: 'paul',
      },
      {
        title: 'AI workflow training - bookkeeping & bank statements',
        description: 'Meeting 10 Apr: Team not using AI effectively. AI can auto-read any bank statement and fill templates - no manual field mapping needed. Ryan to screen-share and review workflow after books are closed.',
        priority: 'medium',
        category: 'general',
        due_date: '2026-04-18',
      },
      {
        title: 'Fix finance dashboard - data still not updated',
        description: 'Meeting 10 Apr: Dashboard data still wrong. Server memory issue. Fix OVERWORLD, Foundation, Palio, Quantummind equity values. Re-sync after deploy.',
        priority: 'urgent',
        category: 'tech',
        due_date: '2026-04-11',
      },
      {
        title: 'Review Evelyn employee dispute contract',
        description: 'Meeting 10 Apr: Evelyn drafting contract for employee dispute. Keith/HR to review.',
        priority: 'medium',
        category: 'legal',
        due_date: '2026-04-16',
      },
      {
        title: 'Reply AOD & 3T audit confirmations - zeroed out',
        description: 'Meeting 10 Apr: Reply by email: all balances zero as of 2025-12-31. LD/3T operations stopped, no TGE. AOD shareholders swapped and cashed out. No need to fill detailed form. For future: always re-confirm even if previously said no activity.',
        priority: 'high',
        category: 'audit',
        due_date: '2026-04-14',
        assigned_to_username: 'mario',
      },
      {
        title: 'Reply Overworld share price audit confirmation',
        description: 'Meeting 10 Apr: Use price per share from spreadsheet. ~$0.52/share ($100K for 190K+ shares).',
        priority: 'medium',
        category: 'audit',
        due_date: '2026-04-14',
        assigned_to_username: 'mario',
      },
    ],
  },
];

export function seedMeetingTasks(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO tasks (title, description, due_date, priority, category, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getUserId = db.prepare('SELECT id FROM users WHERE username = ?');

  for (const batch of MEETING_TASKS) {
    // Check if this meeting's tasks were already seeded
    const existing = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE description LIKE ?"
    ).get(`%${batch.meeting_id.replace('meeting-', 'Meeting ').replace(/-/g, ' ').replace('2026 04 10', '10 Apr')}%`) as any;

    if (existing.count > 0) {
      console.log(`[seed] Tasks from ${batch.meeting_id} already exist, skipping`);
      continue;
    }

    console.log(`[seed] Creating ${batch.tasks.length} tasks from ${batch.meeting_id}...`);
    const ryanId = (getUserId.get('ryan') as any)?.id || 1;

    const tx = db.transaction(() => {
      for (const task of batch.tasks) {
        const assignedTo = task.assigned_to_username
          ? (getUserId.get(task.assigned_to_username) as any)?.id || null
          : null;
        insert.run(task.title, task.description, task.due_date, task.priority, task.category, assignedTo, ryanId);
      }
    });
    tx();
    console.log(`[seed] ${batch.tasks.length} tasks created`);
  }
}
