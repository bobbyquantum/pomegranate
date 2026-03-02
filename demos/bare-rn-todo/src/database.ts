/**
 * Schema & Model definitions for the bare RN demo app.
 */
import { m, Model } from 'pomegranate-db';

// ─── Schema ────────────────────────────────────────────────────────────────

export const TodoSchema = m.model('todos', {
  title: m.text(),
  isCompleted: m.boolean().default(false),
  priority: m.number().default(0),
  notes: m.text().optional(),
  createdAt: m.date('created_at').readonly(),
});

// ─── Model ─────────────────────────────────────────────────────────────────

export class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;

  toggleComplete = this.writer(async () => {
    const current = this.getField('isCompleted');
    await this.update({ isCompleted: !current });
  });
}
