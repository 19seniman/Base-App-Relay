import { ethers } from "ethers";

export class BaseSwapper {
    constructor(provider, wallet) {
        this.provider = provider;
        this.wallet = wallet;
    }

    async getRelayQuote(params) {
        const response = await fetch("https://api.relay.link/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user: this.wallet.address,
                originChainId: 8453, // Base
                destinationChainId: 8453, // Base
                originCurrency: params.tokenIn === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenIn,
                destinationCurrency: params.tokenOut === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenOut,
                amount: params.amountIn.toString(),
                tradeType: "EXACT_INPUT",
                useExternalLiquidity: true,
                referrer: "relay.link/swap"
            })
        });

        const data = await response.json();
        
        if (data.error || !data.steps) {
            const errorMsg = data.message || "Gagal mengambil quote dari Relay";
            if (errorMsg.includes("no routes found")) {
                throw new Error("Tidak ada rute ditemukan. Coba naikkan sedikit jumlah (amount) di .env kamu.");
            }
            throw new Error(errorMsg);
        }
        return data;
    }

    async swap(params) {
        const quote = await this.getRelayQuote(params);

        console.log(`   🔄 Memproses ${quote.steps.length} langkah transaksi...`);

        let lastResponse;

        // Relay memberikan langkah-langkah (steps) yang harus dilakukan secara berurutan
        for (const step of quote.steps) {
            console.log(`   🔸 Menjalankan: ${step.description || step.action}`);
            
            for (const item of step.items) {
                // Perbaikan format ARGUMENT agar compatible dengan Ethers v6
                const txRequest = {
                    to: item.to,
                    data: item.data,
                    value: item.value ? ethers.getBigInt(item.value) : 0n,
                };

                // Jika Relay memberikan estimasi gas, gunakan. Jika tidak, biarkan Ethers menghitung otomatis.
                if (item.gasLimit) {
                    txRequest.gasLimit = ethers.getBigInt(item.gasLimit);
                }

                try {
                    const response = await this.wallet.sendTransaction(txRequest);
                    console.log(`   🔗 Hash: ${response.hash}`);
                    
                    const receipt = await response.wait();
                    if (receipt.status === 0) throw new Error("Transaksi gagal (Reverted)");
                    
                    lastResponse = response;
                } catch (err) {
                    console.error(`   ❌ Eror pada langkah ini: ${err.reason || err.message}`);
                    throw err;
                }
            }
        }
        // Mengembalikan response terakhir agar index.js bisa menampilkan hash-nya
        return { tx: lastResponse };
    }

    async getTokenInfo(address) {
        if (address === "native" || address === "0x0000000000000000000000000000000000000000") {
            const balance = await this.provider.getBalance(this.wallet.address);
            return { symbol: "ETH", decimals: 18, balance };
        }
        const abi = [
            "function balanceOf(address) view returns (uint256)", 
            "function decimals() view returns (uint8)", 
            "function symbol() view returns (string)"
        ];
        const contract = new ethers.Contract(address, abi, this.provider);
        const [balance, decimals, symbol] = await Promise.all([
            contract.balanceOf(this.wallet.address).catch(() => 0n),
            contract.decimals().catch(() => 18),
            contract.symbol().catch(() => "TOKEN")
        ]);
        return { balance, decimals, symbol };
    }
}
