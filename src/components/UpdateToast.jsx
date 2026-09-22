import React, { useEffect, useState } from 'react';

// Shows auto-update progress. In dev there is no feed, so it stays hidden.
export default function UpdateToast() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    return window.hrms.update.onStatus(setStatus);
  }, []);

  if (!status || status.state === 'none' || status.state === 'checking') return null;

  return (
    <div className="update-toast">
      {status.state === 'available' && <>Downloading update {status.version}…</>}
      {status.state === 'downloading' && <>Downloading update… {status.percent}%</>}
      {status.state === 'error' && <>Update check failed.</>}
      {status.state === 'ready' && (
        <>
          Update {status.version} ready.
          <button className="linkbtn" onClick={() => window.hrms.update.install()}>Restart &amp; install</button>
        </>
      )}
    </div>
  );
}
