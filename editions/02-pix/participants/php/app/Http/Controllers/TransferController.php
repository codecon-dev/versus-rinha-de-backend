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
                $inserted = DB::select(
                    "INSERT INTO transfers (id, payer_id, payee_id, amount, idempotency_key, status)
                     VALUES (?, ?, ?, ?, ?, 'pending')
                     ON CONFLICT (idempotency_key) DO NOTHING
                     RETURNING id",
                    [$id, $data['payerId'], $data['payeeId'], $data['amount'], $data['idempotencyKey']]
                );

                if ($inserted === []) {
                    $existing = Transfer::where('idempotency_key', $data['idempotencyKey'])->first();
                    if ($existing !== null) {
                        return response()->json($existing->toApi(), 200);
                    }
                    continue;
                }

                $transfer = Transfer::find($inserted[0]->id);

                return response()->json($transfer->toApi(), 201);
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
