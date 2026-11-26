-- Ishita HRMS local schema. Runs on first launch (idempotent).
-- Lives in its OWN database ("hrms"), never inside the device's "easytime" DB.
--
-- Model mirrors the Hitech payroll reference: Setup holds reusable policies
-- (Shift / Holiday / Leave / Salary components); every employee's profile
-- assigns those policies and carries its salary structure + statutory flags.

-- ---------------------------------------------------------------------------
-- Setup: reusable policies
-- ---------------------------------------------------------------------------

-- Work timings + attendance rules. weekly_offs = day numbers, 0=Sun .. 6=Sat.
CREATE TABLE IF NOT EXISTS shift (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(80) NOT NULL,
    start_time       TIME NOT NULL DEFAULT '09:00',
    end_time         TIME NOT NULL DEFAULT '18:00',
    weekly_offs      INT[] NOT NULL DEFAULT '{0}',
    grace_minutes    INT NOT NULL DEFAULT 30,
    half_day_hours   NUMERIC(4,1) NOT NULL DEFAULT 4,
    full_day_hours   NUMERIC(4,1) NOT NULL DEFAULT 8,
    overtime_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A named holiday calendar for a year.
CREATE TABLE IF NOT EXISTS holiday_policy (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    year       INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holiday (
    id        SERIAL PRIMARY KEY,
    policy_id INT NOT NULL REFERENCES holiday_policy(id) ON DELETE CASCADE,
    hdate     DATE NOT NULL,
    name      VARCHAR(120) NOT NULL,
    type      VARCHAR(10) NOT NULL DEFAULT 'PUBLIC'   -- PUBLIC / OPTIONAL
);

-- Leave policy with its types. cycle = YEARLY / MONTHLY.
CREATE TABLE IF NOT EXISTS leave_policy (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    cycle      VARCHAR(10) NOT NULL DEFAULT 'YEARLY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leave_type (
    id           SERIAL PRIMARY KEY,
    policy_id    INT NOT NULL REFERENCES leave_policy(id) ON DELETE CASCADE,
    name         VARCHAR(80) NOT NULL,
    annual_count NUMERIC(6,2) NOT NULL DEFAULT 0,
    accrual      VARCHAR(16) NOT NULL DEFAULT 'ALL_AT_ONCE', -- ALL_AT_ONCE / MONTHLY
    paid         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Org-wide default salary components (earnings + deductions) new staff inherit.
-- kind = EARNING/DEDUCTION, calc = CTC/BASIC/GROSS/FLAT.
CREATE TABLE IF NOT EXISTS salary_component (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(80) NOT NULL,
    kind       VARCHAR(10) NOT NULL,
    calc       VARCHAR(10) NOT NULL,
    value      NUMERIC(12,2) NOT NULL DEFAULT 0,
    cap        NUMERIC(12,2),
    threshold  NUMERIC(12,2),
    sort_order INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Employees (maps device emp_code) + their salary structure & assigned policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee (
    id            SERIAL PRIMARY KEY,
    emp_code      VARCHAR(20) UNIQUE NOT NULL,   -- = easytime.iclock_transaction.emp_code
    full_name     VARCHAR(150) NOT NULL,
    department    VARCHAR(120),
    designation   VARCHAR(120),
    category      VARCHAR(16) NOT NULL DEFAULT 'REGULAR', -- REGULAR/CONTRACTOR/WORK_BASIS
    date_of_join  DATE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,

    -- salary structure
    monthly_ctc      NUMERIC(12,2) NOT NULL DEFAULT 0,
    basic            NUMERIC(12,2) NOT NULL DEFAULT 0,
    hra              NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
    work_type        VARCHAR(10),                 -- DAILY/HOURLY/PIECE (WORK_BASIS only)
    work_rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
    salary_basis     VARCHAR(10) NOT NULL DEFAULT 'SHIFT', -- SHIFT / PUNCH
    pf               BOOLEAN NOT NULL DEFAULT FALSE,
    esic             BOOLEAN NOT NULL DEFAULT FALSE,
    pt               BOOLEAN NOT NULL DEFAULT FALSE,

    -- assigned setup policies
    shift_id          INT REFERENCES shift(id),
    holiday_policy_id INT REFERENCES holiday_policy(id),
    leave_policy_id   INT REFERENCES leave_policy(id),

    -- bank / statutory
    bank_account VARCHAR(40),
    ifsc         VARCHAR(20),
    bank_name    VARCHAR(120),
    pan          VARCHAR(20),

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Leave requests, payroll runs, payslips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_request (
    id            SERIAL PRIMARY KEY,
    employee_id   INT NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    leave_type_id INT REFERENCES leave_type(id),
    from_date     DATE NOT NULL,
    to_date       DATE NOT NULL,
    status        VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A payroll cycle over any date range: WEEKLY (Thu run), MONTHLY, or CUSTOM.
CREATE TABLE IF NOT EXISTS payroll_run (
    id              SERIAL PRIMARY KEY,
    label           VARCHAR(120),
    period_type     VARCHAR(10) NOT NULL DEFAULT 'WEEKLY', -- WEEKLY/MONTHLY/CUSTOM
    from_date       DATE NOT NULL,
    to_date         DATE NOT NULL,
    apply_statutory BOOLEAN NOT NULL DEFAULT FALSE,        -- PF/ESIC/PT (usually only on monthly)
    status          VARCHAR(12) NOT NULL DEFAULT 'DRAFT',  -- DRAFT/FINALISED
    run_by          VARCHAR(120),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payslip (
    id              SERIAL PRIMARY KEY,
    payroll_run_id  INT NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
    employee_id     INT NOT NULL REFERENCES employee(id),
    present_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    half_days       NUMERIC(6,1) NOT NULL DEFAULT 0,
    paid_leave_days NUMERIC(6,1) NOT NULL DEFAULT 0,
    week_off_days   NUMERIC(6,1) NOT NULL DEFAULT 0,
    holiday_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    absent_days     NUMERIC(6,1) NOT NULL DEFAULT 0,
    payable_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    ot_hours        NUMERIC(8,2) NOT NULL DEFAULT 0,
    gross           NUMERIC(12,2) NOT NULL DEFAULT 0,
    pf              NUMERIC(12,2) NOT NULL DEFAULT 0,
    esic            NUMERIC(12,2) NOT NULL DEFAULT 0,
    pt              NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions      NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
    UNIQUE (payroll_run_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- Seed sensible defaults once (statutory components + a general shift)
-- ---------------------------------------------------------------------------
INSERT INTO salary_component (name, kind, calc, value, cap, threshold, sort_order)
SELECT * FROM (VALUES
    ('Basic',            'EARNING',   'CTC',   50,   NULL,  NULL,  1),
    ('HRA',              'EARNING',   'CTC',   20,   NULL,  NULL,  2),
    ('PF',               'DEDUCTION', 'BASIC', 12,   15000, NULL,  3),
    ('ESIC',             'DEDUCTION', 'GROSS', 0.75, NULL,  NULL,  4),
    ('Professional Tax', 'DEDUCTION', 'FLAT',  200,  NULL,  15000, 5)
) AS v(name, kind, calc, value, cap, threshold, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM salary_component);

INSERT INTO shift (name, start_time, end_time, weekly_offs, grace_minutes)
SELECT 'General (9 AM - 6 PM)', '09:00', '18:00', '{0}', 30
WHERE NOT EXISTS (SELECT 1 FROM shift);

-- ===========================================================================
-- Salary history, paid-period locks and audit log  (added v0.2.0)
-- ===========================================================================
-- Salary is no longer read from the employee row. Every salary an employee has
-- ever had is a row in salary_revision, effective from a date. Rows are only
-- ever added: they cannot be edited, and they cannot be added, or removed,
-- on or before the last date that employee was paid in a FINALISED payroll run.
-- The employee.monthly_ctc/basic/... columns are kept only as the source of
-- the one-time OPENING revision below; nothing reads them for pay any more.

CREATE TABLE IF NOT EXISTS salary_revision (
    id               SERIAL PRIMARY KEY,
    employee_id      INT NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    effective_from   DATE NOT NULL,
    kind             VARCHAR(12) NOT NULL,          -- OPENING/INCREMENT/DECREMENT/CHANGE
    monthly_ctc      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_ctc >= 0),
    basic            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
    hra              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
    other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
    work_type        VARCHAR(10),
    work_rate        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (work_rate >= 0),
    salary_basis     VARCHAR(10) NOT NULL DEFAULT 'SHIFT',
    pf               BOOLEAN NOT NULL DEFAULT FALSE,
    esic             BOOLEAN NOT NULL DEFAULT FALSE,
    pt               BOOLEAN NOT NULL DEFAULT FALSE,
    reason           TEXT,
    created_by       VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, effective_from),
    CONSTRAINT salary_revision_kind_chk
        CHECK (kind IN ('OPENING','INCREMENT','DECREMENT','CHANGE')),
    -- The opening salary covers everything before the first revision.
    CONSTRAINT salary_revision_opening_chk
        CHECK ((kind = 'OPENING') = (effective_from = DATE '2000-01-01'))
);
CREATE INDEX IF NOT EXISTS salary_revision_emp_idx ON salary_revision (employee_id, effective_from);

-- What each payslip was actually paid at: [{from,to,revisionId,monthlyCtc,basic,workRate,...}]
ALTER TABLE payslip ADD COLUMN IF NOT EXISTS salary_snapshot JSONB;
ALTER TABLE payroll_run ADD COLUMN IF NOT EXISTS finalised_by VARCHAR(120);
ALTER TABLE payroll_run ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ;

-- Who changed what, and what it was before. Rows can never be edited or removed.
CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor      VARCHAR(120) NOT NULL,
    action     VARCHAR(40)  NOT NULL,
    entity     VARCHAR(40)  NOT NULL,
    entity_id  INT,
    before     JSONB,
    after      JSONB,
    note       TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id);

-- One OPENING revision per employee, copied from today's salary columns.
-- Safe to run every launch: only employees without any revision get one.
INSERT INTO salary_revision (employee_id, effective_from, kind, monthly_ctc, basic, hra,
    other_allowances, work_type, work_rate, salary_basis, pf, esic, pt, reason, created_by)
SELECT e.id, DATE '2000-01-01', 'OPENING', e.monthly_ctc, e.basic, e.hra,
       e.other_allowances, e.work_type, e.work_rate, e.salary_basis, e.pf, e.esic, e.pt,
       'Salary before salary history was introduced', 'system'
FROM employee e
WHERE NOT EXISTS (SELECT 1 FROM salary_revision r WHERE r.employee_id = e.id);

-- Last day an employee has been paid for in a FINALISED run (NULL = never paid).
CREATE OR REPLACE FUNCTION hrms_last_paid_date(emp INT) RETURNS DATE AS $$
    SELECT MAX(r.to_date)
    FROM payslip p JOIN payroll_run r ON r.id = p.payroll_run_id
    WHERE p.employee_id = emp AND r.status = 'FINALISED'
$$ LANGUAGE sql STABLE;

-- These guards are the last line of defence: they hold even if the app has a
-- bug or someone edits the tables directly in pgAdmin.
CREATE OR REPLACE FUNCTION salary_revision_guard() RETURNS trigger AS $$
DECLARE paid DATE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Salary history cannot be edited. Add a new salary revision instead.';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.kind = 'OPENING' THEN
            IF EXISTS (SELECT 1 FROM salary_revision WHERE employee_id = NEW.employee_id) THEN
                RAISE EXCEPTION 'This employee already has an opening salary.';
            END IF;
            RETURN NEW;
        END IF;
        paid := hrms_last_paid_date(NEW.employee_id);
        IF paid IS NOT NULL AND NEW.effective_from <= paid THEN
            RAISE EXCEPTION 'Salary is already paid up to %. A new salary can start from % at the earliest.',
                to_char(paid, 'DD Mon YYYY'), to_char(paid + 1, 'DD Mon YYYY');
        END IF;
        RETURN NEW;
    END IF;

    -- DELETE. When the employee row itself is being deleted, let the cascade through.
    IF NOT EXISTS (SELECT 1 FROM employee WHERE id = OLD.employee_id) THEN
        RETURN OLD;
    END IF;
    IF OLD.kind = 'OPENING' THEN
        RAISE EXCEPTION 'The opening salary cannot be removed.';
    END IF;
    paid := hrms_last_paid_date(OLD.employee_id);
    IF paid IS NOT NULL AND OLD.effective_from <= paid THEN
        RAISE EXCEPTION 'This salary has already been paid (up to %) and cannot be removed.',
            to_char(paid, 'DD Mon YYYY');
    END IF;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS salary_revision_guard_trg ON salary_revision;
CREATE TRIGGER salary_revision_guard_trg
    BEFORE INSERT OR UPDATE OR DELETE ON salary_revision
    FOR EACH ROW EXECUTE FUNCTION salary_revision_guard();

-- A FINALISED run is paid: it cannot be reopened, edited or deleted.
CREATE OR REPLACE FUNCTION payroll_run_guard() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'FINALISED' THEN
        RAISE EXCEPTION 'Payroll run "%" is finalised (paid) and cannot be changed or deleted.',
            COALESCE(OLD.label, OLD.id::text);
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status NOT IN ('DRAFT', 'FINALISED') THEN
            RAISE EXCEPTION 'Unknown payroll status %', NEW.status;
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payroll_run_guard_trg ON payroll_run;
CREATE TRIGGER payroll_run_guard_trg
    BEFORE UPDATE OR DELETE ON payroll_run
    FOR EACH ROW EXECUTE FUNCTION payroll_run_guard();

CREATE OR REPLACE FUNCTION payslip_guard() RETURNS trigger AS $$
DECLARE st VARCHAR;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT status INTO st FROM payroll_run WHERE id = OLD.payroll_run_id;
        IF st = 'FINALISED' THEN
            RAISE EXCEPTION 'Payslips of a finalised (paid) payroll run cannot be changed.';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    SELECT status INTO st FROM payroll_run WHERE id = NEW.payroll_run_id;
    IF st = 'FINALISED' THEN
        RAISE EXCEPTION 'Payslips of a finalised (paid) payroll run cannot be changed.';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payslip_guard_trg ON payslip;
CREATE TRIGGER payslip_guard_trg
    BEFORE INSERT OR UPDATE OR DELETE ON payslip
    FOR EACH ROW EXECUTE FUNCTION payslip_guard();

CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'The audit log cannot be edited or deleted.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_guard_trg ON audit_log;
CREATE TRIGGER audit_log_guard_trg
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
