import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

const bigintTransformer = {
    to: (value: number) => value,
    from: (value: string) => parseInt(value, 10),
};

@Entity('transfers')
export class TransferEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string | undefined;

    @Column({ type: 'varchar', length: 64, name: 'payer_id' })
    payerId: string | undefined;

    @Column({ type: 'varchar', length: 64, name: 'payee_id' })
    payeeId: string | undefined;

    @Column({ type: 'bigint', transformer: bigintTransformer })
    amount: number | undefined;

    @Column({ type: 'varchar', length: 128, unique: true, name: 'idempotency_key' })
    idempotencyKey: string | undefined;

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: string | undefined;

    @Column({ type: 'text', nullable: true, name: 'failure_reason' })
    failureReason: string | null | undefined;

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date | undefined;
}