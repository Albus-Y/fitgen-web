# 实现过程中遇到的问题

## 3.1 retarget问题
一开始受SKEL影响想采用 SMPL -> virtual points -> OpenSim IK 得到 OpenSim 骨骼的运动学，但有两个问题：
1. SKEL采用的BSM模型虽然是.osim，但是用Nimble导出的，和OpenSim不兼容，无法正常IK
   ![[Pasted image 20261019120617.png]]
2. 换用全身肌肉覆盖的模型cathures之后，virtual points 和 cathures 的对应关系缺少标注，部分骨骼对应错误导致 retarget 效果很差，多处跳变
该用SMPL骨骼和catherus对应的方法进行retarget之后没有大范围跳变了。
## 3.2 肌肉甩出人体
![[Pasted image 20261019114430.png]]
![[Pasted image 20261019114255.png]]
