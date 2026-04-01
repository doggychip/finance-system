import { Router } from 'express';
import Database from 'better-sqlite3';
import { LedgerService } from '../services/ledger-service';

export function reportRoutes(db: Database.Database): Router {
  const router = Router();
  const service = new LedgerService(db);

  router.get('/trial-balance', (req, res) => {
    const asOfDate = req.query.as_of_date as string | undefined;
    res.json(service.getTrialBalance(asOfDate));
  });

  router.get('/balance-sheet', (req, res) => {
    const asOfDate = req.query.as_of_date as string | undefined;
    res.json(service.getBalanceSheet(asOfDate));
  });

  router.get('/income-statement', (req, res) => {
    const startDate = req.query.start_date as string | undefined;
    const endDate = req.query.end_date as string | undefined;
    res.json(service.getIncomeStatement(startDate, endDate));
  });

  router.get('/account-ledger/:id', (req, res) => {
    const id = req.params.id as string;
    const startDate = req.query.start_date as string | undefined;
    const endDate = req.query.end_date as string | undefined;
    res.json(service.getAccountLedger(id, startDate, endDate));
  });

  return router;
}
