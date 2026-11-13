// Single CUDA context, simulated driver. The caller changes the VRAM budget
// between batches, including below the capacity of an existing allocation.
#include "cuda_score.hpp"
#include <array>
#include <cassert>
int main(){
    CudaScore device;
    assert(device.open());
    std::array<unsigned char,128*7> cards{};
    for(size_t i=0;i<cards.size();i++)cards[i]=static_cast<unsigned char>(i%7);
    std::array<int,128> scores{};
    assert(device.begin(cards.data(),128,2048));
    assert(device.finish(scores.data(),128));
    for(int score:scores)assert(score==scores.front());
    assert(device.allocated()==128*11);
    assert(!device.begin(cards.data(),128,1000));
    assert(device.begin(cards.data(),1,11));
    assert(device.finish(scores.data(),1));
    assert(device.allocated()==11);
    assert(!device.begin(cards.data(),0,11));
    device.releaseBuffers();
    assert(device.allocated()==0);
}
