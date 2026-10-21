import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/buttonClasses';
import { ErrorState } from '../components/PageState';

export function NotFoundPage() {
  return (
    <ErrorState
      title="Page not found"
      description="The page you're looking for doesn't exist."
      action={
        <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
          Back to home
        </Link>
      }
    />
  );
}
