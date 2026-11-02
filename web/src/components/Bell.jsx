import { Link } from 'react-router-dom';
import { useFetch } from '../ui.jsx';

export default function Bell({ to = '/notifications' }) {
  const { data } = useFetch('/notifications', { live: ['notifications'] });
  const unread = (data || []).filter((n) => !n.read_at).length;
  return (
    <Link to={to} className="bell d-inline-flex align-items-center justify-content-center" style={{ justifyContent: 'center', textDecoration: 'none' }} aria-label={`الإشعارات ${unread}`}>
      🔔{unread > 0 && <span className="dot">{unread}</span>}
    </Link>
  );
}
