<?php

namespace App\Http\Controllers;

use App\Models\Transfer;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;


class TransferController extends Controller
{
    private const PG_FK_VIOLATION = '23503';
    private const PG_DEADLOCK = '40P01';
    private const PG_SERIALIZATION_FAILURE = '40001';

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payerId' => ['required', 'string', 'max:64'],
            'payeeId' => ['required', 'string', 'max:64', 'different:payerId'],
            'amount' => ['required', 'integer', 'min:1'],
            'idempotencyKey' => ['required', 'string', 'max:128'],
        ]);

        $id = (string) Str::uuid();

        for ($attempts = 0; $attempts < 5; $attempts++) {
            try {
                // DO UPDATE (no-op) força RETURNING mesmo em conflito, e faz a tx
                // concorrente serializar corretamente: o perdedor bloqueia até o
                // vencedor commitar, então sempre enxergamos a linha final.
                // xmax = 0 diferencia INSERT novo (201) de conflito resolvido (200).
                $row = DB::selectOne(
                    "INSERT INTO transfers (id, payer_id, payee_id, amount, idempotency_key, status)
                     VALUES (?, ?, ?, ?, ?, 'pending')
                     ON CONFLICT (idempotency_key) DO UPDATE
                         SET idempotency_key = EXCLUDED.idempotency_key
                     RETURNING id, (xmax = 0) AS inserted",
                    [$id, $data['payerId'], $data['payeeId'], $data['amount'], $data['idempotencyKey']]
                );

                $transfer = Transfer::find($row->id);

                return response()->json($transfer->toApi(), $row->inserted ? 201 : 200);
            } catch (QueryException $e) {
                $code = $e->getCode();

                if ($code === self::PG_FK_VIOLATION) {
                    return response()->json(['error' => 'account_not_found'], 422);
                }

                if ($code === self::PG_DEADLOCK || $code === self::PG_SERIALIZATION_FAILURE) {
                    usleep(random_int(1000, 5000) * ($attempts + 1));
                    continue;
                }

                throw $e;
            }
        }

        return response()->json(['error' => 'conflict_retry_exhausted'], 503);
    }

    public function show(string $id): JsonResponse
    {
        $transfer = Transfer::find($id);

        if ($transfer === null) {
            return response()->json(['error' => 'transfer_not_found'], 404);
        }

        return response()->json($transfer->toApi());
    }
}
