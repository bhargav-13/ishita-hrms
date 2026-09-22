import React, { useEffect, useState } from 'react';

// Pre-setup hub. Configure reusable policies once, then assign them to each
// employee on their salary profile. Mirrors the Hitech payroll Setup screen.
export default function Setup({ onOpen }) {
  const [counts, setCounts] = useState({ shifts: 0, holidays: 0, leaves: 0, components: 0 });

  useEffect(() => {
    Promise.all([
      window.hrms.shifts.list(),
      window.hrms.holidays.list(),
      window.hrms.leaves.list(),
      window.hrms.components.list(),
    ]).then(([s, h, l, c]) =>
      setCounts({ shifts: s.length, holidays: h.length, leaves: l.length, components: c.length })
    ).catch(() => {});
  }, []);

  const cards = [
    { key: 'setup/shifts', icon: '🕑', title: 'Shifts',
      desc: 'Work timings, weekly-offs, grace period and overtime rules.',
      count: `${counts.shifts} shift${counts.shifts === 1 ? '' : 's'}`, ready: counts.shifts > 0 },
    { key: 'setup/holidays', icon: '🌴', title: 'Holiday Policy',
      desc: 'Named holiday calendars — public and optional holidays per year.',
      count: `${counts.holidays} ${counts.holidays === 1 ? 'policy' : 'policies'}`, ready: counts.holidays > 0 },
    { key: 'setup/leave', icon: '📅', title: 'Leave Policy',
      desc: 'Leave types with annual counts and how they accrue.',
      count: `${counts.leaves} ${counts.leaves === 1 ? 'policy' : 'policies'}`, ready: counts.leaves > 0 },
    { key: 'setup/salary', icon: '🪙', title: 'Salary Components',
      desc: 'Default earnings & deductions (Basic, HRA, PF, ESIC, PT…) new staff inherit.',
      count: `${counts.components} component${counts.components === 1 ? '' : 's'}`, ready: counts.components > 0 },
  ];

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Configure your payroll policies once, then assign them to each employee on their profile.
      </p>
      <div className="grid-cards">
        {cards.map((c) => (
          <div key={c.key} className="setup-card" onClick={() => onOpen(c.key)}>
            <div className="row-between">
              <div className="ico">{c.icon}</div>
              <span className={'pill ' + (c.ready ? 'ok' : 'warn')}>{c.count}</span>
            </div>
            <h4>{c.title}</h4>
            <p className="muted" style={{ margin: 0 }}>{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
