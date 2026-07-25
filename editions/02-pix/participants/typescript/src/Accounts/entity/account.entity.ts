import { Entity, PrimaryColumn, Column } from 'typeorm';

const bigintTransformer = {
    to: (value: number) => value,
    from: (value: string) => parseInt(value, 10),
};

@Entity('accounts')
export class Accounts {
    @PrimaryColumn({ type: 'varchar', length: 64 })
    id: string | undefined;

    @Column({ name: 'balance', type: 'bigint', nullable: false, transformer: bigintTransformer })
    balance: number | undefined;

    @Column({ name: 'created_at', type: 'timestamptz', nullable: false, default: () => 'NOW()' })
    created_at: Date | undefined;

    @Column({ name: 'updated_at', type: 'timestamptz', nullable: false, default: () => 'NOW()' })
    updated_at: Date | undefined;
}