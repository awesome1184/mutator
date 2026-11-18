import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../mutator_daily_grid_puzzle.tsx';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('MUTATOR root element was not found.');
}

createRoot(root).render(<App />);
