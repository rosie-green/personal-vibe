-- Example starter data. Safe to skip: the app has "add task" / "add medicine" screens.
-- Run once on an empty database:  npm run db:seed:local   (or db:seed:remote)
--
-- NOTE: `date('now')` is today's date in UTC. If you seed between midnight and 1am UK
-- summer time, that's still "yesterday" in UTC, so the tasks would start a day early
-- (yesterday would show as missed). If that matters, replace date('now') with a fixed
-- date like '2026-11-01' before running.

INSERT INTO medications (id, name, unit, pack_size, pack_label, reorder_lead_days, order_cover_days, auto_supplied, notes)
VALUES (1, 'Estrogen', 'dose', 64, 'tube', NULL, 90, 1,
        'Private clinic sends prescriptions automatically, so no reorder alerts.');

-- 4 doses per completion of the estrogen task, taken once a day.
INSERT INTO dose_schedules (medication_id, amount, every_n_days, effective_from)
VALUES (1, 4, 1, date('now'));

INSERT INTO tasks (id, name, time_of_day, medication_id, reminder_text, done_text, sort_order, active_from)
VALUES
  (1, 'Estrogen', 'morning', 1,
   'Time for your estrogen.',
   'Good job on doing your estrogen today!' || char(10) || char(10) || 'Check back tomorrow.',
   10, date('now')),
  (2, 'Teeth brushing', 'evening', NULL,
   'Don''t forget to brush your teeth in the evening.',
   'Teeth brushed. Nice one!' || char(10) || char(10) || 'Check back tomorrow.',
   20, date('now'));
