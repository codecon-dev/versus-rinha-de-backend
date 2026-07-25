import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ValidaPixWorker } from "./ValidaPix.worker";
import { TransferEntity } from "../Transfers/entity/transfers.entity";
import { Accounts } from "../Accounts/entity/account.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([TransferEntity, Accounts]),
    ],
    providers: [ValidaPixWorker],
})
export class ValidaPixModule { }