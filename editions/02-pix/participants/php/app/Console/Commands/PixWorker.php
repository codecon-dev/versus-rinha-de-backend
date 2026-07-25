<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class PixWorker extends Command
{
    protected $signature = 'pix:worker {--batch=50 : quantas pending por rodada} {--sleep=25 : ms quando nao ha trabalho}';

    protected $description = 'Loop de liquidacao das transferencias PIX pendentes';

    public function handle(): int
    {
        $batch = (int) $this->option('batch');
        $sleepMs = (int) $this->option('sleep');

        pcntl_async_signals(true);
        $shouldStop = false;
        $stop = function () use (&$shouldStop) {
            $shouldStop = true;
        };
        pcntl_signal(SIGTERM, $stop);
        pcntl_signal(SIGINT, $stop);

        $this->info('pix:worker iniciado');

        while (! $shouldStop) {
            $processed = 0;

            $ids = DB::select(
                'SELECT id FROM transfers
                  WHERE status = ?
                  ORDER BY created_at
                  LIMIT ?',
                ['pending', $batch]
            );

            foreach ($ids as $row) {
                if ($shouldStop) {
                    break;
                }
                if ($this->settleOneWithRetry($row->id)) {
                    $processed++;
                }
            }

            if ($processed === 0) {
                usleep($sleepMs * 1000);
            }
        }

        $this->info('pix:worker encerrado');

        return self::SUCCESS;
    }

    private function settleOneWithRetry(string $id): bool
    {
        $attempts = 0;
        while (true) {
            try {
                return $this->settleOne($id);
            } catch (Throwable $e) {
                $sqlState = $e instanceof \PDOException ? ($e->errorInfo[0] ?? null) : null;
                $isDeadlock = $sqlState === '40P01' || str_contains($e->getMessage(), '40P01');
                $isSerialization = $sqlState === '40001' || str_contains($e->getMessage(), '40001');

                if (($isDeadlock || $isSerialization) && $attempts < 5) {
                    $attempts++;
                    usleep((int) (random_int(1, 5) * 1000 * $attempts));
                    continue;
                }

                $this->error("erro liquidando {$id}: ".$e->getMessage());

                return false;
            }
        }
    }

    private function settleOne(string $id): bool
    {
        return DB::transaction(function () use ($id) {
            $rows = DB::select(
                "SELECT id, payer_id, payee_id, amount
                   FROM transfers
                  WHERE id = ? AND status = 'pending'
                  FOR UPDATE SKIP LOCKED",
                [$id]
            );

            if ($rows === []) {
                return false;
            }

            $t = $rows[0];

            $ids = $t->payer_id === $t->payee_id
                ? [$t->payer_id]
                : (strcmp($t->payer_id, $t->payee_id) < 0
                    ? [$t->payer_id, $t->payee_id]
                    : [$t->payee_id, $t->payer_id]);

            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $accounts = DB::select(
                "SELECT id, balance FROM accounts WHERE id IN ($placeholders) ORDER BY id FOR UPDATE",
                $ids
            );

            $byId = [];
            foreach ($accounts as $a) {
                $byId[$a->id] = (int) $a->balance;
            }

            $payerBalance = $byId[$t->payer_id] ?? null;
            $payeeBalance = $byId[$t->payee_id] ?? null;

            if ($payerBalance === null || $payeeBalance === null) {
                DB::update(
                    "UPDATE transfers
                        SET status = 'failed',
                            failure_reason = 'account_not_found',
                            processed_at = NOW()
                      WHERE id = ? AND status = 'pending'",
                    [$t->id]
                );

                return true;
            }

            $amount = (int) $t->amount;

            if ($payerBalance < $amount) {
                DB::update(
                    "UPDATE transfers
                        SET status = 'failed',
                            failure_reason = 'insufficient_funds',
                            processed_at = NOW()
                      WHERE id = ? AND status = 'pending'",
                    [$t->id]
                );

                return true;
            }

            DB::update(
                'UPDATE accounts SET balance = balance - ?, updated_at = NOW() WHERE id = ?',
                [$amount, $t->payer_id]
            );
            DB::update(
                'UPDATE accounts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
                [$amount, $t->payee_id]
            );
            DB::update(
                "UPDATE transfers
                    SET status = 'completed',
                        processed_at = NOW()
                  WHERE id = ? AND status = 'pending'",
                [$t->id]
            );

            return true;
        });
    }
}
